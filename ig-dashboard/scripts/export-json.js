// Pre-render: chiama la Graph API lato server e scrive public/data.json.
// Consumato dal dashboard quando VITE_USE_STATIC=true (deploy GitHub Pages).
// Per-range 7/30/90 così il date selector resta funzionante anche sul pubblico.
//
// Usage:
//   npm run export-json
//
// Richiede le stesse env del snapshot: IG_PAGE_TOKEN (o src/config.js), IG_PAGE_ID.
// Non tocca Turso: legge tutto live dalla Graph API.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@libsql/client";
import { isFakeToken } from "../src/fakeData.js";
import { derivePostAnalytics, detectRestart } from "../src/analytics.js";
import {
  createGql,
  loadCredentials,
  resolveIgUserId,
  fetchProfile,
  fetchDayTotals,
  fetchReachDaily,
  fetchMedia,
  fetchAudience as fetchAudienceFromGraph,
} from "./ig-fetch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "..", "public");
const OUT_FILE = resolve(PUBLIC_DIR, "data.json");

const { token: TOKEN, pageId: PAGE_ID } = await loadCredentials();

// Niente più ranges precomputed via Graph API: il dashboard calcola tutti i
// totali da `daily_snapshot` (somma reach giornaliero), stessa fonte per
// 7g/30g/custom. Evita la discontinuità del numero quando si passa da
// total_value (≤30g) a chunking (>30g) e la confusione tra metriche
// diverse (unique cross-day vs account-giorni cumulati).
const RANGES = [];
const DAY_SECONDS = 86400;

// Storico post + daily da Turso (facoltativo: se env assenti → ritorna vuoti,
// il dashboard gestisce la mancanza con sparkline nascosti).
async function fetchHistoryFromTurso(postIds) {
  // Trim per resistere a secret paste-ati con whitespace/newline finali
  // (classico pitfall dei GitHub Secrets)
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const tok = process.env.TURSO_AUTH_TOKEN?.trim();
  console.log(
    `[history] TURSO_DATABASE_URL present=${!!url} (len=${url?.length || 0}) · TURSO_AUTH_TOKEN present=${!!tok} (len=${tok?.length || 0})`
  );
  if (!url) {
    console.log("[history] TURSO_DATABASE_URL assente — skip history, sparkline vuoti");
    return { postHistory: {}, followerTrend: [] };
  }
  try {
    const db = createClient({
      url,
      authToken: tok,
    });

    // Serie storica post snapshot (per i post nel feed attuale)
    const postHistory = {};
    if (postIds.length > 0) {
      const placeholders = postIds.map(() => "?").join(",");
      const res = await db.execute({
        sql: `SELECT post_id, fetched_at, reach, like_count, comments_count, saved, shares, views,
                     video_view_total_time, avg_watch_time
              FROM post_snapshot
              WHERE post_id IN (${placeholders})
              ORDER BY fetched_at ASC`,
        args: postIds,
      });
      for (const row of res.rows) {
        const id = row.post_id;
        if (!postHistory[id]) postHistory[id] = [];
        postHistory[id].push({
          t: Number(row.fetched_at),
          reach: Number(row.reach) || 0,
          likes: Number(row.like_count) || 0,
          comments: Number(row.comments_count) || 0,
          saved: Number(row.saved) || 0,
          shares: Number(row.shares) || 0,
          views: Number(row.views) || 0,
          // Reel-only (REELS): null sui non-reel. ms.
          video_view_total_time:
            row.video_view_total_time == null
              ? null
              : Number(row.video_view_total_time),
          avg_watch_time:
            row.avg_watch_time == null ? null : Number(row.avg_watch_time),
        });
      }
    }

    // Serie storica daily — completa con tutte le 5 metriche.
    // Serve per due cose: trend follower + base per il calcolo client-side
    // dei totali su range custom (vedi App.jsx static mode).
    const dayRes = await db.execute(
      `SELECT date, followers_count, follows_count, media_count,
              reach, profile_views, website_clicks,
              accounts_engaged, total_interactions
       FROM daily_snapshot ORDER BY date ASC`
    );
    const followerTrend = dayRes.rows.map((r) => ({
      date: r.date,
      followers: Number(r.followers_count) || 0,
      follows: Number(r.follows_count) || 0,
      reach: Number(r.reach) || 0,
      profile_views: Number(r.profile_views) || 0,
      website_clicks: Number(r.website_clicks) || 0,
      engaged: Number(r.accounts_engaged) || 0,
      interactions: Number(r.total_interactions) || 0,
    }));

    // Stories ultimi 30gg: metadata + ultimo snapshot per ognuna +
    // curva 24h (utile per visualizzare il decay nelle prime ore).
    const STORIES_WINDOW_DAYS = 30;
    const cutoffMs = Date.now() - STORIES_WINDOW_DAYS * 86400000;
    const cutoffIso = new Date(cutoffMs).toISOString();
    const storyRes = await db.execute({
      sql: `SELECT story_id, timestamp, media_type, permalink, media_url,
                   thumbnail_url, expires_at
            FROM story
            WHERE timestamp >= ?
            ORDER BY timestamp DESC`,
      args: [cutoffIso],
    });
    const stories = [];
    const storyHistory = {};
    if (storyRes.rows.length > 0) {
      const ids = storyRes.rows.map((r) => r.story_id);
      const ph = ids.map(() => "?").join(",");
      const snapRes = await db.execute({
        sql: `SELECT story_id, fetched_at, reach, replies, navigation,
                     shares, total_interactions
              FROM story_snapshot WHERE story_id IN (${ph})
              ORDER BY fetched_at ASC`,
        args: ids,
      });
      for (const r of snapRes.rows) {
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
      for (const r of storyRes.rows) {
        const hist = storyHistory[r.story_id] || [];
        const latest = hist[hist.length - 1] || {};
        stories.push({
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
        });
      }
    }

    console.log(
      `[history] OK: ${Object.keys(postHistory).length} post con storico, ${followerTrend.length} giorni nel trend, ${stories.length} stories ultimi ${STORIES_WINDOW_DAYS}gg`
    );
    return { postHistory, followerTrend, stories, storyHistory };
  } catch (e) {
    console.error(`[history] Turso fetch FALLITO: ${e.message} — continuo senza`);
    console.error(e.stack);
    return { postHistory: {}, followerTrend: [], stories: [], storyHistory: {} };
  }
}

// Audience: prima prova Turso (dato già fotografato dallo snapshot cron,
// risparmiamo 4 call Graph API a ogni export). Se Turso non ha righe
// recenti, fallback a Graph API diretta.
async function fetchAudienceSmart(gql, ig) {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  if (url) {
    try {
      const db = createClient({
        url,
        authToken: process.env.TURSO_AUTH_TOKEN?.trim(),
      });
      const dateRes = await db.execute(
        "SELECT MAX(date) AS d FROM audience_snapshot"
      );
      const date = dateRes.rows[0]?.d;
      if (date) {
        const res = await db.execute({
          sql: `SELECT breakdown, key, value
                FROM audience_snapshot
                WHERE date = ?
                ORDER BY breakdown, value DESC`,
          args: [date],
        });
        if (res.rows.length > 0) {
          const out = {};
          for (const r of res.rows) {
            if (!out[r.breakdown]) out[r.breakdown] = [];
            out[r.breakdown].push({
              key: r.key,
              value: Number(r.value),
            });
          }
          console.log(`Audience da Turso (snapshot del ${date})`);
          return out;
        }
      }
    } catch (e) {
      console.warn(
        `Turso audience fetch fallito: ${e.message} — fallback Graph API`
      );
    }
  }
  console.log("Audience da Graph API (live)");
  return fetchAudienceFromGraph(gql, ig);
}

async function snapshotForRange(gql, ig, days, restartUnix = null) {
  const until = Math.floor(Date.now() / 1000);
  const rawSince = until - days * DAY_SECONDS;
  // Clamp alla ripartenza: i giorni pre-rinascita sono un'altra vita
  // dell'account (audience, voice, contesto diversi) e contaminano il numero.
  // Se la finestra dichiarata inizia prima della ripartenza, accorciamo.
  const since = restartUnix && restartUnix > rawSince ? restartUnix : rawSince;
  const wasClamped = since !== rawSince;
  const sincePrev = since - (until - since);
  const untilPrev = since;
  // Se il periodo precedente cade interamente nel pre-rinascita, niente
  // delta (sarebbe fuorviante).
  const prevValid = !restartUnix || sincePrev >= restartUnix;

  const [cur, prev, reachDaily] = await Promise.all([
    fetchDayTotals(gql, ig, since, until),
    prevValid
      ? fetchDayTotals(gql, ig, sincePrev, untilPrev)
      : Promise.resolve({ totals: {}, errors: [] }),
    fetchReachDaily(gql, ig, since, until),
  ]);

  return {
    totals: cur.totals,
    totalsPrev: prevValid ? prev.totals : {},
    reachDaily,
    warnings: cur.errors,
    sinceClamped: wasClamped ? since : null,
    requestedDays: days,
  };
}

async function main() {
  if (isFakeToken(TOKEN)) {
    console.error(
      "TOKEN vuoto — impossibile generare data.json. Configura IG_PAGE_TOKEN."
    );
    process.exit(1);
  }
  if (!PAGE_ID) {
    console.error("PAGE_ID mancante.");
    process.exit(1);
  }

  mkdirSync(PUBLIC_DIR, { recursive: true });
  const gql = createGql({ token: TOKEN });
  const igUserId = await resolveIgUserId(gql, PAGE_ID);
  console.log(`IG User ID: ${igUserId}`);

  const [profile, mediaResp, audience] = await Promise.all([
    fetchProfile(gql, igUserId),
    fetchMedia(gql, igUserId, 30),
    fetchAudienceSmart(gql, igUserId),
  ]);
  const posts = mediaResp.posts;

  // Restart detection: il gap di pubblicazione più grande sopra soglia ci
  // dice da quando l'account è "vivo" (ADR detectRestart). Tutti i range
  // vengono clampati a partire da qui — altrimenti i giorni di silenzio
  // pre-rinascita gonfiano il denominatore.
  const restart = detectRestart(posts);
  if (restart) {
    console.log(
      `Restart rilevato: ripartenza ${restart.restart_date_only} dopo pausa di ${restart.pause_days}g · ` +
        `${restart.pre_pause_post_count} post pre, ${restart.post_restart_count} post post`
    );
  }
  const restartUnix = restart
    ? Math.floor(new Date(restart.restart_iso).getTime() / 1000)
    : null;

  const ranges = {}; // intenzionalmente vuoto, vedi nota su RANGES sopra
  // suppress unused: snapshotForRange e RANGES restano nel codice per
  // poter riattivare ranges precomputed se serve un giorno.
  void snapshotForRange;
  void RANGES;

  // Storico opzionale da Turso (post_snapshot + daily_snapshot + stories)
  const postIds = posts.map((p) => p.id);
  const { postHistory, followerTrend, stories, storyHistory } =
    await fetchHistoryFromTurso(postIds);
  const postAnalytics = derivePostAnalytics(posts, postHistory, profile);

  const payload = {
    generatedAt: Date.now(),
    profile,
    posts,
    audience,
    restart,
    ranges,
    postHistory,
    followerTrend,
    postAnalytics,
    stories,
    storyHistory,
  };

  writeFileSync(OUT_FILE, JSON.stringify(payload));
  const sizeKb = (JSON.stringify(payload).length / 1024).toFixed(1);
  console.log(`OK export → ${OUT_FILE} (${sizeKb} KB)`);
  console.log(
    `Contiene: profilo, ${posts.length} post, ${
      audience ? Object.keys(audience).length : 0
    } audience breakdown, ${RANGES.length} range pre-calcolati (${RANGES.join(
      "/"
    )}g).`
  );
}

main().catch((err) => {
  console.error("KO export:", err.message);
  process.exit(1);
});
