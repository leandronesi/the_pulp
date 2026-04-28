// Vite plugin: espone /api/dev/history in dev mode.
// Ritorna lo storico Turso (daily_snapshot, post_snapshot, story_snapshot)
// che la Graph API live non sa darci. Permette al dashboard in dev di
// mostrare le sparkline follower / curve post / curve stories anche senza
// passare dal pre-render statico (data.json).
//
// In produzione (build statico) il plugin non gira → /api/dev/history 404,
// e il dashboard usa data.json come al solito.

import { createClient } from "@libsql/client";

let cachedDb = null;
function db() {
  if (cachedDb) return cachedDb;
  const url = process.env.TURSO_DATABASE_URL?.trim();
  if (!url) return null;
  cachedDb = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN?.trim(),
  });
  return cachedDb;
}

async function buildHistory() {
  const client = db();
  if (!client) {
    return { error: "TURSO_DATABASE_URL non settata in .env" };
  }
  const [dailyRes, postSnapRes, storyMetaRes, storySnapRes] = await Promise.all([
    client.execute(
      `SELECT date, followers_count, follows_count, media_count,
              reach, profile_views, website_clicks,
              accounts_engaged, total_interactions
       FROM daily_snapshot ORDER BY date ASC`
    ),
    client.execute(
      `SELECT post_id, fetched_at, reach, like_count, comments_count,
              saved, shares, views, video_view_total_time, avg_watch_time
       FROM post_snapshot ORDER BY fetched_at ASC`
    ),
    client.execute(
      `SELECT story_id, timestamp, media_type, permalink, media_url,
              thumbnail_url, expires_at
       FROM story
       WHERE timestamp >= date('now', '-30 days')
       ORDER BY timestamp DESC`
    ),
    client.execute(
      `SELECT s.story_id, s.fetched_at, s.reach, s.replies, s.navigation,
              s.shares, s.total_interactions
       FROM story_snapshot s
       INNER JOIN story st ON st.story_id = s.story_id
       WHERE st.timestamp >= date('now', '-30 days')
       ORDER BY s.fetched_at ASC`
    ),
  ]);

  const followerTrend = dailyRes.rows.map((r) => ({
    date: r.date,
    followers: Number(r.followers_count) || 0,
    follows: Number(r.follows_count) || 0,
    reach: Number(r.reach) || 0,
    profile_views: Number(r.profile_views) || 0,
    website_clicks: Number(r.website_clicks) || 0,
    engaged: Number(r.accounts_engaged) || 0,
    interactions: Number(r.total_interactions) || 0,
  }));

  const postHistory = {};
  for (const r of postSnapRes.rows) {
    if (!postHistory[r.post_id]) postHistory[r.post_id] = [];
    postHistory[r.post_id].push({
      t: Number(r.fetched_at),
      reach: Number(r.reach) || 0,
      likes: Number(r.like_count) || 0,
      comments: Number(r.comments_count) || 0,
      saved: Number(r.saved) || 0,
      shares: Number(r.shares) || 0,
      views: Number(r.views) || 0,
      // Reel-only (REELS): null sui non-reel. ms.
      video_view_total_time:
        r.video_view_total_time == null ? null : Number(r.video_view_total_time),
      avg_watch_time:
        r.avg_watch_time == null ? null : Number(r.avg_watch_time),
    });
  }

  const storyHistory = {};
  for (const r of storySnapRes.rows) {
    if (!storyHistory[r.story_id]) storyHistory[r.story_id] = [];
    storyHistory[r.story_id].push({
      t: Number(r.fetched_at),
      reach: Number(r.reach) || 0,
      replies: Number(r.replies) || 0,
      navigation: Number(r.navigation) || 0,
      shares: Number(r.shares) || 0,
      total_interactions: Number(r.total_interactions) || 0,
    });
  }

  // Lista stories: ultimo snapshot per ognuna (Graph API in dev mode da' solo
  // le attive < 24h, qui restituiamo l'archivio completo per la tab Stories).
  const stories = storyMetaRes.rows.map((r) => {
    const hist = storyHistory[r.story_id] || [];
    const latest = hist[hist.length - 1] || {};
    return {
      id: r.story_id,
      timestamp: r.timestamp,
      media_type: r.media_type,
      permalink: r.permalink,
      media_url: r.media_url,
      thumbnail_url: r.thumbnail_url,
      expires_at: Number(r.expires_at) || null,
      reach: latest.reach || 0,
      replies: latest.replies || 0,
      navigation: latest.navigation || 0,
      shares: latest.shares || 0,
      total_interactions: latest.total_interactions || 0,
    };
  });

  return { followerTrend, postHistory, storyHistory, stories };
}

export default function devDataPlugin() {
  return {
    name: "dev-data-plugin",
    apply: "serve", // solo in dev, mai in build
    configureServer(server) {
      server.middlewares.use("/api/dev/history", async (req, res) => {
        try {
          const payload = await buildHistory();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(payload));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    },
  };
}
