// Dump analitico: estrae i dati di Turso che servono al deep dive umano
// (analista + social media manager). Output: reports/raw-dump-YYYY-MM-DD.json
// — letto poi dall'analista (Claude o umano) per produrre il deep dive.
//
// Niente analisi qui: solo SELECT. La narrativa la scrive l'analista a parte.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getDb, getDbTarget } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = resolve(__dirname, "..", "..", "reports");
mkdirSync(REPORTS_DIR, { recursive: true });

const todayIso = new Date().toISOString().slice(0, 10);
const OUT = resolve(REPORTS_DIR, `raw-dump-${todayIso}.json`);

const db = await getDb();
console.log(`[dump] target: ${getDbTarget()}`);

const rows = async (sql, args = []) => (await db.execute({ sql, args })).rows;

// 1. Daily snapshot — ultimi 60g
const dailies = await rows(
  `SELECT date, fetched_at, followers_count, follows_count, media_count,
          reach, profile_views, accounts_engaged, total_interactions
     FROM daily_snapshot
    ORDER BY date ASC`
);

// 2. Post + ULTIMO snapshot per ogni post
const posts = await rows(`
  SELECT p.post_id, p.timestamp, p.media_type, p.caption, p.permalink,
         ls.like_count, ls.comments_count, ls.reach, ls.saved, ls.shares, ls.views,
         ls.avg_watch_time, ls.video_view_total_time
    FROM post p
    LEFT JOIN (
      SELECT ps.*
        FROM post_snapshot ps
       WHERE ps.fetched_at = (
         SELECT MAX(fetched_at) FROM post_snapshot WHERE post_id = ps.post_id
       )
    ) ls ON ls.post_id = p.post_id
   ORDER BY p.timestamp DESC
`);

// 3. Curve di crescita: tutti i snapshot per i post post-ripartenza (06/03/2026)
const curves = await rows(`
  SELECT post_id, fetched_at, reach, like_count, comments_count, saved, shares, views, avg_watch_time
    FROM post_snapshot
   WHERE post_id IN (SELECT post_id FROM post WHERE timestamp >= '2026-03-06')
   ORDER BY post_id, fetched_at ASC
`);

// 4. Stories + ultimo snapshot
const stories = await rows(`
  SELECT s.story_id, s.timestamp, s.media_type, s.expires_at,
         ls.reach, ls.replies, ls.navigation, ls.shares, ls.total_interactions
    FROM story s
    LEFT JOIN (
      SELECT ss.*
        FROM story_snapshot ss
       WHERE ss.fetched_at = (
         SELECT MAX(fetched_at) FROM story_snapshot WHERE story_id = ss.story_id
       )
    ) ls ON ls.story_id = s.story_id
   ORDER BY s.timestamp DESC
`);

// 5. Curve stories (per capire se la reach satura presto)
const storyCurves = await rows(`
  SELECT story_id, fetched_at, reach, replies, navigation, shares
    FROM story_snapshot
   ORDER BY story_id, fetched_at ASC
`);

// 6. Audience: ultime due date disponibili (per confronto/shift)
const audDates = await rows(
  `SELECT DISTINCT date FROM audience_snapshot ORDER BY date DESC LIMIT 2`
);
const audience = {};
for (const r of audDates) {
  audience[r.date] = await rows(
    `SELECT breakdown, key, value FROM audience_snapshot WHERE date = ? ORDER BY breakdown, value DESC`,
    [r.date]
  );
}

// 7. Run log ultimi 7g (per capire se i cron sono affidabili)
const runLog = await rows(`
  SELECT id, kind, status, started_at, finished_at, summary, error
    FROM run_log
   WHERE started_at >= (strftime('%s', 'now', '-7 days') * 1000)
   ORDER BY started_at DESC
   LIMIT 200
`);

// 8. Conteggi rapidi
const counts = {
  daily_snapshot: (await rows(`SELECT COUNT(*) AS c FROM daily_snapshot`))[0].c,
  post: (await rows(`SELECT COUNT(*) AS c FROM post`))[0].c,
  post_snapshot: (await rows(`SELECT COUNT(*) AS c FROM post_snapshot`))[0].c,
  story: (await rows(`SELECT COUNT(*) AS c FROM story`))[0].c,
  story_snapshot: (await rows(`SELECT COUNT(*) AS c FROM story_snapshot`))[0].c,
  audience_snapshot: (await rows(`SELECT COUNT(*) AS c FROM audience_snapshot`))[0].c,
};

const out = {
  generated_at: new Date().toISOString(),
  target: getDbTarget(),
  counts,
  dailies,
  posts,
  curves,
  stories,
  story_curves: storyCurves,
  audience,
  run_log: runLog,
};

writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`[dump] scritto ${OUT}`);
console.log(`[dump] counts:`, counts);
