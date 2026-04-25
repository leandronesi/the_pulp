// Snapshot dei dati IG → DB (Turso o locale).
//
// Due mode:
//   npm run snapshot          → FULL: profilo, totali giorno, 30 post, audience
//   npm run snapshot:fresh    → FRESH: solo post pubblicati negli ultimi 7gg,
//                                  solo upsert post + insert post_snapshot
//
// Idempotente sulla data per FULL (UPSERT su daily_snapshot); ogni run aggiunge
// righe nuove in post_snapshot per tracciare la curva di crescita.
//
// Credenziali IG:
//   - Locale: src/config.js (gitignorato)
//   - CI / env: IG_PAGE_TOKEN, IG_PAGE_ID → hanno la precedenza sui valori di config.js
//
// In fake mode (TOKEN vuoto) esce subito senza toccare il DB.

import { isFakeToken } from "../src/fakeData.js";
import {
  getDb,
  getDbMode,
  getDbTarget,
  todayIsoDate,
  startRunLog,
  endRunLog,
  setMeta,
  getMeta,
} from "./db.js";
import {
  createGql,
  loadCredentials,
  resolveIgUserId as resolveIgUserIdRaw,
  fetchProfile,
  fetchDayTotals,
  fetchMedia,
  fetchAudience,
  rangeSinceUntil,
  metricOf,
} from "./ig-fetch.js";

const { token: TOKEN, pageId: PAGE_ID, api: API } = await loadCredentials();

const FRESH_ONLY = process.argv.includes("--fresh-only");
const FRESH_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// Wrapper che cachea ig_user_id in tabella meta (seconda run in poi, 1 call in meno).
async function resolveIgUserId(gql) {
  const cached = await getMeta("ig_user_id");
  if (cached) return cached;
  const id = await resolveIgUserIdRaw(gql, PAGE_ID);
  await setMeta("ig_user_id", id);
  return id;
}

// Scrive post + post_snapshot in una transazione batch. In fresh mode filtra
// i post alla finestra di FRESH_WINDOW_DAYS (evita di snapshottare post morti).
async function writePosts(db, posts, fetchedAt, { freshOnly }) {
  let toWrite = posts;
  if (freshOnly) {
    const cutoff = Date.now() - FRESH_WINDOW_DAYS * DAY_MS;
    toWrite = posts.filter((p) => new Date(p.timestamp).getTime() >= cutoff);
  }
  const statements = [];
  for (const p of toWrite) {
    statements.push({
      sql: `INSERT INTO post
            (post_id, timestamp, media_type, caption, permalink, media_url, thumbnail_url, first_seen, last_updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(post_id) DO UPDATE SET
              timestamp = excluded.timestamp,
              media_type = excluded.media_type,
              caption = excluded.caption,
              permalink = excluded.permalink,
              media_url = excluded.media_url,
              thumbnail_url = excluded.thumbnail_url,
              last_updated = excluded.last_updated`,
      args: [
        p.id,
        p.timestamp,
        p.media_type,
        p.caption ?? null,
        p.permalink ?? null,
        p.media_url ?? null,
        p.thumbnail_url ?? null,
        fetchedAt,
        fetchedAt,
      ],
    });
    statements.push({
      sql: `INSERT OR REPLACE INTO post_snapshot
            (post_id, fetched_at, like_count, comments_count, reach, saved, shares, views)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        p.id,
        fetchedAt,
        p.like_count ?? 0,
        p.comments_count ?? 0,
        metricOf(p, "reach"),
        metricOf(p, "saved"),
        metricOf(p, "shares"),
        metricOf(p, "views"),
      ],
    });
  }
  if (statements.length) await db.batch(statements, "write");
  return toWrite.length;
}

async function main() {
  if (isFakeToken(TOKEN)) {
    const msg =
      "TOKEN vuoto → snapshot skippato. Configura IG_PAGE_TOKEN in env o src/config.js.";
    // Su CI (GitHub Actions) falliamo rumorosi: un workflow verde ma senza
    // scrittura è peggio di un workflow rosso. In locale (dev) esce silenzioso.
    if (process.env.CI || process.env.GITHUB_ACTIONS) {
      console.error(msg);
      process.exit(1);
    }
    console.log(msg);
    process.exit(0);
  }
  if (!PAGE_ID) {
    console.error("PAGE_ID mancante (env IG_PAGE_ID o src/config.js).");
    process.exit(1);
  }

  const db = await getDb();
  const mode = FRESH_ONLY ? "fresh-only" : "full";
  console.log(`DB target (${getDbMode()}): ${getDbTarget()}`);
  console.log(`Mode: ${mode}`);

  const runId = await startRunLog(FRESH_ONLY ? "snapshot-fresh" : "snapshot");
  const date = todayIsoDate();
  const fetchedAt = Date.now();
  let fbErrors = [];

  try {
    const gql = createGql({ token: TOKEN, api: API });
    const igUserId = await resolveIgUserId(gql);
    console.log(`IG User ID: ${igUserId}`);

    if (FRESH_ONLY) {
      // ── Fresh mode: solo i post recenti, nient'altro ────────────
      const { posts } = await fetchMedia(gql, igUserId, 30);
      const written = await writePosts(db, posts, fetchedAt, {
        freshOnly: true,
      });

      const summary = {
        mode: "fresh-only",
        window_days: FRESH_WINDOW_DAYS,
        posts_fetched: posts.length,
        posts_written: written,
      };
      console.log("OK snapshot:");
      console.log(JSON.stringify(summary, null, 2));

      await endRunLog(runId, {
        status: "ok",
        summary: JSON.stringify(summary),
      });
      return;
    }

    // ── Full mode: profilo, totali, audience, tutti i post ────────
    const { since, until } = rangeSinceUntil(1);
    const [profile, totalsResp, mediaResp, audience] = await Promise.all([
      fetchProfile(gql, igUserId),
      fetchDayTotals(gql, igUserId, since, until),
      fetchMedia(gql, igUserId, 30),
      fetchAudience(gql, igUserId),
    ]);

    const { totals, errors: totErr } = totalsResp;
    fbErrors = [...fbErrors, ...totErr];
    if (mediaResp.error) {
      fbErrors.push(`media insights: ${mediaResp.error}`);
    }
    const posts = mediaResp.posts;

    // 1. daily_snapshot (upsert per data)
    await db.execute({
      sql: `INSERT INTO daily_snapshot
            (date, fetched_at, followers_count, follows_count, media_count,
             reach, profile_views, website_clicks, accounts_engaged, total_interactions, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
              fetched_at = excluded.fetched_at,
              followers_count = excluded.followers_count,
              follows_count = excluded.follows_count,
              media_count = excluded.media_count,
              reach = excluded.reach,
              profile_views = excluded.profile_views,
              website_clicks = excluded.website_clicks,
              accounts_engaged = excluded.accounts_engaged,
              total_interactions = excluded.total_interactions,
              raw_json = excluded.raw_json`,
      args: [
        date,
        fetchedAt,
        profile.followers_count ?? null,
        profile.follows_count ?? null,
        profile.media_count ?? null,
        totals.reach ?? null,
        totals.profile_views ?? null,
        totals.website_clicks ?? null,
        totals.accounts_engaged ?? null,
        totals.total_interactions ?? null,
        JSON.stringify({ profile, totals }),
      ],
    });

    // 2. post + post_snapshot
    const written = await writePosts(db, posts, fetchedAt, {
      freshOnly: false,
    });

    // 3. audience_snapshot
    const audStatements = [];
    for (const [breakdown, rows] of Object.entries(audience || {})) {
      for (const { key, value } of rows) {
        audStatements.push({
          sql: `INSERT OR REPLACE INTO audience_snapshot (date, breakdown, key, value)
                VALUES (?, ?, ?, ?)`,
          args: [date, breakdown, key, value],
        });
      }
    }
    if (audStatements.length) await db.batch(audStatements, "write");

    const summary = {
      mode: "full",
      date,
      followers: profile.followers_count,
      posts_written: written,
      audience_rows: audStatements.length,
      metric_errors: fbErrors.length,
    };
    console.log("OK snapshot:");
    console.log(JSON.stringify(summary, null, 2));
    if (fbErrors.length) {
      console.warn("\nMetriche fallite (non fatali):");
      for (const e of fbErrors) console.warn(` · ${e}`);
    }

    await endRunLog(runId, {
      status: fbErrors.length ? "partial" : "ok",
      summary: JSON.stringify(summary),
    });
  } catch (err) {
    console.error("KO snapshot:", err.message);
    await endRunLog(runId, { status: "error", error: err.message });
    process.exit(1);
  }
}

main();
