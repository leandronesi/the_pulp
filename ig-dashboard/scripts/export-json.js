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

const RANGES = [7, 30, 90];
const DAY_SECONDS = 86400;

// Storico post + daily da Turso (facoltativo: se env assenti → ritorna vuoti,
// il dashboard gestisce la mancanza con sparkline nascosti).
async function fetchHistoryFromTurso(postIds) {
  const url = process.env.TURSO_DATABASE_URL;
  const tok = process.env.TURSO_AUTH_TOKEN;
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
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    // Serie storica post snapshot (per i post nel feed attuale)
    const postHistory = {};
    if (postIds.length > 0) {
      const placeholders = postIds.map(() => "?").join(",");
      const res = await db.execute({
        sql: `SELECT post_id, fetched_at, reach, like_count, comments_count, saved, shares, views
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
        });
      }
    }

    // Serie storica daily (follower trend + reach giornaliero reale)
    const dayRes = await db.execute(
      `SELECT date, followers_count, follows_count, media_count,
              reach, accounts_engaged, total_interactions
       FROM daily_snapshot ORDER BY date ASC`
    );
    const followerTrend = dayRes.rows.map((r) => ({
      date: r.date,
      followers: Number(r.followers_count) || 0,
      follows: Number(r.follows_count) || 0,
      reach: Number(r.reach) || 0,
      engaged: Number(r.accounts_engaged) || 0,
      interactions: Number(r.total_interactions) || 0,
    }));

    console.log(
      `[history] OK: ${Object.keys(postHistory).length} post con storico, ${followerTrend.length} giorni nel trend`
    );
    return { postHistory, followerTrend };
  } catch (e) {
    console.error(`[history] Turso fetch FALLITO: ${e.message} — continuo senza`);
    console.error(e.stack);
    return { postHistory: {}, followerTrend: [] };
  }
}

// Audience: prima prova Turso (dato già fotografato dallo snapshot cron,
// risparmiamo 4 call Graph API a ogni export). Se Turso non ha righe
// recenti, fallback a Graph API diretta.
async function fetchAudienceSmart(gql, ig) {
  const url = process.env.TURSO_DATABASE_URL;
  if (url) {
    try {
      const db = createClient({
        url,
        authToken: process.env.TURSO_AUTH_TOKEN,
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

async function snapshotForRange(gql, ig, days) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * DAY_SECONDS;
  const sincePrev = until - 2 * days * DAY_SECONDS;
  const untilPrev = since;

  const [cur, prev, reachDaily] = await Promise.all([
    fetchDayTotals(gql, ig, since, until),
    fetchDayTotals(gql, ig, sincePrev, untilPrev),
    fetchReachDaily(gql, ig, since, until),
  ]);

  return {
    totals: cur.totals,
    totalsPrev: prev.totals,
    reachDaily,
    warnings: cur.errors,
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

  const ranges = {};
  for (const d of RANGES) {
    console.log(`Range ${d}d…`);
    ranges[d] = await snapshotForRange(gql, igUserId, d);
  }

  // Storico opzionale da Turso (post_snapshot + daily_snapshot)
  const postIds = posts.map((p) => p.id);
  const { postHistory, followerTrend } = await fetchHistoryFromTurso(postIds);

  const payload = {
    generatedAt: Date.now(),
    profile,
    posts,
    audience,
    ranges,
    postHistory,
    followerTrend,
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
