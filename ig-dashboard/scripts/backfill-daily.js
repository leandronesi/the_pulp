// Backfill di daily_snapshot per i giorni precedenti al primo cron.
//
// Contesto: il cron daily ha iniziato a popolare daily_snapshot il 24 aprile
// 2026 (run #1). Pre-24-apr il DB è vuoto. La Graph API però accetta finestre
// passate per metric_type=total_value (deduplicato unique 24h per ogni giorno).
// Possiamo quindi ricostruire la storia mancante chiamando Graph API per ogni
// singolo giorno tra start-date e first-daily-in-db.
//
// Usage:
//   npm run backfill-daily              → default: dal restart-date al giorno
//                                          prima del primo daily attuale
//   npm run backfill-daily -- --from=YYYY-MM-DD --to=YYYY-MM-DD
//
// Idempotente: usa lo stesso UPSERT di snapshot.js (PK su date). Ri-runnare
// sovrascrive con valori più recenti se la Graph API ha aggiornato i numeri.
//
// LIMITI:
// - followers_count, follows_count, media_count restano NULL: IG espone solo
//   il valore corrente, non la storia. Per i giorni passati non li abbiamo.
// - audience_snapshot non si fa backfill: stesso motivo.

import { isFakeToken } from "../src/fakeData.js";
import { detectRestart } from "../src/analytics.js";
import {
  getDb,
  getDbTarget,
  startRunLog,
  endRunLog,
} from "./db.js";
import {
  createGql,
  loadCredentials,
  resolveIgUserId,
  fetchDayTotals,
  fetchMedia,
} from "./ig-fetch.js";

const { token: TOKEN, pageId: PAGE_ID } = await loadCredentials();
const DAY_SECONDS = 86400;

function parseArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : null;
}

function isoDate(unixSec) {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

function dateToUnixDayStart(iso) {
  return Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 1000);
}

async function main() {
  if (isFakeToken(TOKEN)) {
    console.error("TOKEN vuoto. Configura IG_PAGE_TOKEN.");
    process.exit(1);
  }

  const db = await getDb();
  console.log(`Target DB: ${getDbTarget()}`);

  // Determina la finestra di backfill.
  const fromArg = parseArg("from");
  const toArg = parseArg("to");

  let fromUnix, toUnix;
  if (fromArg && toArg) {
    fromUnix = dateToUnixDayStart(fromArg);
    toUnix = dateToUnixDayStart(toArg);
  } else {
    // Default: dal restart al giorno prima del primo daily esistente.
    const gql = createGql({ token: TOKEN });
    const ig = await resolveIgUserId(gql, PAGE_ID);
    const mediaResp = await fetchMedia(gql, ig, 50);
    const restart = detectRestart(mediaResp.posts);
    if (!restart) {
      console.error("Restart non rilevato. Specifica --from e --to.");
      process.exit(1);
    }
    fromUnix = dateToUnixDayStart(restart.restart_date_only);

    const firstDailyRes = await db.execute(
      `SELECT MIN(date) AS d FROM daily_snapshot`
    );
    const firstDaily = firstDailyRes.rows[0]?.d;
    if (!firstDaily) {
      // DB vuoto: backfill fino a ieri
      toUnix = Math.floor(Date.now() / 1000) - DAY_SECONDS;
    } else {
      toUnix = dateToUnixDayStart(firstDaily) - DAY_SECONDS;
    }
    console.log(`Restart: ${restart.restart_date_only} · primo daily attuale: ${firstDaily || "(vuoto)"}`);
  }

  if (fromUnix > toUnix) {
    console.log(`Niente da fare: ${isoDate(fromUnix)} > ${isoDate(toUnix)}`);
    return;
  }

  const totalDays = Math.round((toUnix - fromUnix) / DAY_SECONDS) + 1;
  console.log(`Backfill: ${isoDate(fromUnix)} → ${isoDate(toUnix)} (${totalDays} giorni)`);

  const runId = await startRunLog(db, "backfill-daily");

  const gql = createGql({ token: TOKEN });
  const ig = await resolveIgUserId(gql, PAGE_ID);

  let ok = 0;
  let failed = 0;
  let cursor = fromUnix;
  while (cursor <= toUnix) {
    const date = isoDate(cursor);
    const dayEnd = cursor + DAY_SECONDS;
    try {
      const res = await fetchDayTotals(gql, ig, cursor, dayEnd);
      const t = res.totals;
      await db.execute({
        sql: `INSERT INTO daily_snapshot
              (date, fetched_at, followers_count, follows_count, media_count,
               reach, profile_views, website_clicks, accounts_engaged, total_interactions, raw_json)
              VALUES (?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(date) DO UPDATE SET
                fetched_at = excluded.fetched_at,
                reach = COALESCE(daily_snapshot.reach, excluded.reach),
                profile_views = COALESCE(daily_snapshot.profile_views, excluded.profile_views),
                website_clicks = COALESCE(daily_snapshot.website_clicks, excluded.website_clicks),
                accounts_engaged = COALESCE(daily_snapshot.accounts_engaged, excluded.accounts_engaged),
                total_interactions = COALESCE(daily_snapshot.total_interactions, excluded.total_interactions),
                raw_json = excluded.raw_json`,
        args: [
          date,
          Date.now(),
          t.reach ?? null,
          t.profile_views ?? null,
          t.website_clicks ?? null,
          t.accounts_engaged ?? null,
          t.total_interactions ?? null,
          JSON.stringify({ source: "backfill", totals: t }),
        ],
      });
      console.log(`  ${date}: reach=${t.reach} · profile_views=${t.profile_views} · interactions=${t.total_interactions}`);
      ok += 1;
    } catch (e) {
      console.error(`  ${date}: FAILED ${e.message}`);
      failed += 1;
    }
    cursor = dayEnd;
  }

  await endRunLog(db, runId, {
    status: failed === 0 ? "ok" : "partial",
    summary: `Backfill ${isoDate(fromUnix)} → ${isoDate(toUnix)}: ${ok} ok, ${failed} failed`,
  });

  console.log(`\nFatto: ${ok} giorni scritti, ${failed} falliti.`);
  console.log("NB: followers_count/audience_snapshot non sono backfillati (IG non espone storico).");
}

main().catch((e) => {
  console.error("Backfill error:", e);
  process.exit(1);
});
