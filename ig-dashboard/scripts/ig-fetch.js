// Fetch verso Facebook Graph API — condiviso da snapshot.js, export-json.js,
// briefing.js. Point of truth unico per i shape delle richieste e per la
// gestione errori; chi chiama passa un `gql` già legato a token+API.
//
// Uso tipico:
//   import { createGql, resolveIgUserId, fetchProfile, ... } from "./ig-fetch.js";
//   const gql = createGql({ token, api });
//   const igUserId = await resolveIgUserId(gql, pageId);
//   const profile = await fetchProfile(gql, igUserId);

const DAY_SECONDS = 86400;

const METRICS_DAY = [
  "reach",
  "profile_views",
  "website_clicks",
  "accounts_engaged",
  "total_interactions",
];

const AUDIENCE_BREAKDOWNS = ["age", "gender", "city", "country"];

const MEDIA_FIELDS_WITH_INSIGHTS =
  "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,insights.metric(reach,saved,shares,views)";

const MEDIA_FIELDS_NO_INSIGHTS =
  "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";

export function createGql({ token, api = "https://graph.facebook.com/v21.0" }) {
  if (!token) throw new Error("createGql: token mancante");
  return async function gql(path) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${api}${path}${sep}access_token=${token}`;
    const r = await fetch(url);
    const j = await r.json();
    if (j.error) {
      const e = new Error(`${j.error.message} (code ${j.error.code})`);
      e.fbError = j.error;
      throw e;
    }
    return j;
  };
}

export async function resolveIgUserId(gql, pageId) {
  const res = await gql(`/${pageId}?fields=instagram_business_account`);
  const id = res.instagram_business_account?.id;
  if (!id) throw new Error("Nessun IG Business Account collegato alla Page");
  return id;
}

export async function fetchProfile(gql, ig) {
  return gql(
    `/${ig}?fields=username,name,biography,profile_picture_url,followers_count,follows_count,media_count`
  );
}

// Ritorna { totals: {metric: value}, errors: [str] }. Metriche che falliscono
// sono null; il caller decide se segnalarle nei warnings.
export async function fetchDayTotals(gql, ig, sinceUnix, untilUnix) {
  const out = {};
  const errors = [];
  await Promise.all(
    METRICS_DAY.map(async (m) => {
      try {
        const j = await gql(
          `/${ig}/insights?metric=${m}&metric_type=total_value&period=day&since=${sinceUnix}&until=${untilUnix}`
        );
        out[m] = j.data?.[0]?.total_value?.value ?? null;
      } catch (e) {
        errors.push(`${m}: ${e.message}`);
        out[m] = null;
      }
    })
  );
  return { totals: out, errors };
}

// Helper comodo per calcolare since/until di un range in giorni
export function rangeSinceUntil(days) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * DAY_SECONDS;
  return { since, until };
}

export async function fetchReachDaily(gql, ig, sinceUnix, untilUnix) {
  try {
    const j = await gql(
      `/${ig}/insights?metric=reach&period=day&since=${sinceUnix}&until=${untilUnix}`
    );
    return j.data?.[0]?.values || [];
  } catch {
    return [];
  }
}

// Fallback: se la versione con insights embedded fallisce (p.es. post pre-
// conversione Business), riprova senza insights. Il caller gestisce l'assenza.
export async function fetchMedia(gql, ig, limit = 30) {
  try {
    const j = await gql(
      `/${ig}/media?fields=${MEDIA_FIELDS_WITH_INSIGHTS}&limit=${limit}`
    );
    return { posts: j.data || [], hadInsights: true };
  } catch (e) {
    const fb = await gql(
      `/${ig}/media?fields=${MEDIA_FIELDS_NO_INSIGHTS}&limit=${limit}`
    );
    return { posts: fb.data || [], hadInsights: false, error: e.message };
  }
}

// Audience: silenzioso su errore (sotto 100 follower engaged Meta lo blocca).
// Restituisce null se nessun breakdown ha prodotto righe.
export async function fetchAudience(gql, ig) {
  const out = {};
  await Promise.all(
    AUDIENCE_BREAKDOWNS.map(async (b) => {
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
        /* silent */
      }
    })
  );
  return Object.keys(out).length ? out : null;
}

// Estrae un valore metric dagli insights embedded di un post.
export const metricOf = (post, name) =>
  post.insights?.data?.find((x) => x.name === name)?.values?.[0]?.value ?? 0;

// Credenziali IG da env o da default config — usato da tutti gli script
// per uniformità. Restituisce { token, pageId, api }.
export async function loadCredentials() {
  let defaultConfig = { TOKEN: "", PAGE_ID: "", API: "" };
  try {
    defaultConfig = await import("../src/config.js");
  } catch {
    /* no config.js, solo env */
  }
  return {
    token: process.env.IG_PAGE_TOKEN || defaultConfig.TOKEN || "",
    pageId: process.env.IG_PAGE_ID || defaultConfig.PAGE_ID || "",
    api:
      process.env.IG_API ||
      defaultConfig.API ||
      "https://graph.facebook.com/v21.0",
  };
}
