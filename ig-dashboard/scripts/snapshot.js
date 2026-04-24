// Daily snapshot: fetch dei dati IG correnti → DB (Turso o locale).
// Idempotente sulla data: rilanciare lo stesso giorno aggiorna daily_snapshot
// ma aggiunge una nuova riga in post_snapshot (by design — tracciamo la curva).
//
// Uso: npm run snapshot
//
// In fake mode (TOKEN vuoto in src/config.js) esce subito senza toccare il DB.

import { TOKEN, PAGE_ID, API } from "../src/config.js";
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

const DAY_SECONDS = 86400;

async function gql(path) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${API}${path}${sep}access_token=${TOKEN}`;
  const r = await fetch(url);
  const j = await r.json();
  if (j.error) {
    const e = new Error(`${j.error.message} (code ${j.error.code})`);
    e.fbError = j.error;
    throw e;
  }
  return j;
}

async function resolveIgUserId() {
  const cached = await getMeta("ig_user_id");
  if (cached) return cached;
  const res = await gql(`/${PAGE_ID}?fields=instagram_business_account`);
  const id = res.instagram_business_account?.id;
  if (!id) throw new Error("Nessun IG Business Account collegato alla Page");
  await setMeta("ig_user_id", id);
  return id;
}

async function fetchProfile(ig) {
  const fields =
    "username,name,biography,followers_count,follows_count,media_count";
  return gql(`/${ig}?fields=${fields}`);
}

async function fetchDayTotals(ig) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - DAY_SECONDS;
  const metrics = [
    "reach",
    "profile_views",
    "website_clicks",
    "accounts_engaged",
    "total_interactions",
  ];
  const out = {};
  const errors = [];
  await Promise.all(
    metrics.map(async (m) => {
      try {
        const j = await gql(
          `/${ig}/insights?metric=${m}&metric_type=total_value&period=day&since=${since}&until=${until}`
        );
        out[m] = j.data?.[0]?.total_value?.value ?? 0;
      } catch (e) {
        errors.push(`${m}: ${e.message}`);
        out[m] = null;
      }
    })
  );
  return { totals: out, errors };
}

async function fetchRecentPosts(ig) {
  const fields =
    "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,insights.metric(reach,saved,shares,views)";
  const j = await gql(`/${ig}/media?fields=${fields}&limit=30`);
  return j.data || [];
}

async function fetchAudience(ig) {
  const breakdowns = ["age", "gender", "city", "country"];
  const out = {};
  await Promise.all(
    breakdowns.map(async (b) => {
      try {
        const j = await gql(
          `/${ig}/insights?metric=follower_demographics&breakdown=${b}&period=lifetime&metric_type=total_value`
        );
        const rows =
          j.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
        out[b] = rows
          .map((r) => ({
            key: r.dimension_values?.[0] ?? "—",
            value: r.value ?? 0,
          }))
          .filter((r) => r.value > 0);
      } catch {
        /* silenzioso: spesso bloccato sotto 100 follower engaged */
      }
    })
  );
  return out;
}

const metricOf = (post, name) =>
  post.insights?.data?.find((x) => x.name === name)?.values?.[0]?.value ?? 0;

async function main() {
  if (isFakeToken(TOKEN)) {
    console.log(
      "TOKEN vuoto (fake mode) → snapshot skippato. Inserisci un Page token valido in src/config.js."
    );
    process.exit(0);
  }

  const db = await getDb();
  console.log(`DB target (${getDbMode()}): ${getDbTarget()}`);

  const runId = await startRunLog("snapshot");
  const date = todayIsoDate();
  const fetchedAt = Date.now();
  let fbErrors = [];

  try {
    const igUserId = await resolveIgUserId();
    console.log(`IG User ID: ${igUserId}`);

    const [profile, totalsResp, posts, audience] = await Promise.all([
      fetchProfile(igUserId),
      fetchDayTotals(igUserId),
      fetchRecentPosts(igUserId),
      fetchAudience(igUserId),
    ]);

    const { totals, errors: totErr } = totalsResp;
    fbErrors = [...fbErrors, ...totErr];

    // ── 1. daily_snapshot ──────────────────────────────────────────
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

    // ── 2. post + post_snapshot in batch transactionale ───────────
    const postStatements = [];
    for (const p of posts) {
      postStatements.push({
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
      postStatements.push({
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
    if (postStatements.length) await db.batch(postStatements, "write");

    // ── 3. audience_snapshot ───────────────────────────────────────
    const audStatements = [];
    for (const [breakdown, rows] of Object.entries(audience)) {
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
      date,
      followers: profile.followers_count,
      posts_seen: posts.length,
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
