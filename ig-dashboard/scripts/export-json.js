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
import { isFakeToken } from "../src/fakeData.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "..", "public");
const OUT_FILE = resolve(PUBLIC_DIR, "data.json");

// Credenziali — env > config.js
let defaultConfig = { TOKEN: "", PAGE_ID: "", API: "" };
try {
  defaultConfig = await import("../src/config.js");
} catch {
  /* no config.js, ci affidiamo alle env */
}
const TOKEN = process.env.IG_PAGE_TOKEN || defaultConfig.TOKEN || "";
const PAGE_ID = process.env.IG_PAGE_ID || defaultConfig.PAGE_ID || "";
const API =
  process.env.IG_API ||
  defaultConfig.API ||
  "https://graph.facebook.com/v21.0";

const RANGES = [7, 30, 90];
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
  const res = await gql(`/${PAGE_ID}?fields=instagram_business_account`);
  const id = res.instagram_business_account?.id;
  if (!id) throw new Error("Nessun IG Business Account collegato alla Page");
  return id;
}

async function fetchProfile(ig) {
  return gql(
    `/${ig}?fields=username,name,biography,profile_picture_url,followers_count,follows_count,media_count`
  );
}

async function fetchTotals(ig, since, until) {
  const metrics = [
    "reach",
    "profile_views",
    "website_clicks",
    "accounts_engaged",
    "total_interactions",
  ];
  const out = {};
  const warnings = [];
  await Promise.all(
    metrics.map(async (m) => {
      try {
        const j = await gql(
          `/${ig}/insights?metric=${m}&metric_type=total_value&period=day&since=${since}&until=${until}`
        );
        out[m] = j.data?.[0]?.total_value?.value ?? null;
      } catch (e) {
        warnings.push(`${m}: ${e.message}`);
        out[m] = null;
      }
    })
  );
  return { totals: out, warnings };
}

async function fetchReachDaily(ig, since, until) {
  try {
    const j = await gql(
      `/${ig}/insights?metric=reach&period=day&since=${since}&until=${until}`
    );
    return j.data?.[0]?.values || [];
  } catch {
    return [];
  }
}

async function fetchMedia(ig) {
  const fields =
    "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,insights.metric(reach,saved,shares,views)";
  try {
    const j = await gql(`/${ig}/media?fields=${fields}&limit=30`);
    return j.data || [];
  } catch {
    const fb = await gql(
      `/${ig}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=30`
    );
    return fb.data || [];
  }
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
        /* silenzioso */
      }
    })
  );
  return Object.keys(out).length ? out : null;
}

async function snapshotForRange(ig, days) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * DAY_SECONDS;
  const sincePrev = until - 2 * days * DAY_SECONDS;
  const untilPrev = since;

  const [cur, prev, reachDaily] = await Promise.all([
    fetchTotals(ig, since, until),
    fetchTotals(ig, sincePrev, untilPrev),
    fetchReachDaily(ig, since, until),
  ]);

  return {
    totals: cur.totals,
    totalsPrev: prev.totals,
    reachDaily,
    warnings: cur.warnings,
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
  const igUserId = await resolveIgUserId();
  console.log(`IG User ID: ${igUserId}`);

  const [profile, posts, audience] = await Promise.all([
    fetchProfile(igUserId),
    fetchMedia(igUserId),
    fetchAudience(igUserId),
  ]);

  const ranges = {};
  for (const d of RANGES) {
    console.log(`Range ${d}d…`);
    ranges[d] = await snapshotForRange(igUserId, d);
  }

  const payload = {
    generatedAt: Date.now(),
    profile,
    posts,
    audience,
    ranges,
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
