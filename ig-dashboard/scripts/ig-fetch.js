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
  "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,insights.metric(reach,saved,shares,views)";

const MEDIA_FIELDS_NO_INSIGHTS =
  "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";

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

// Ritorna { totals: {metric: value}, errors: [str], fallbackUsed: [metric] }.
// Per range > 30gg Meta ritorna spesso null su metric_type=total_value. In
// quel caso proviamo il fallback: fetch del time series daily e somma. Non è
// deduplicato cross-day (stesso utente visto in 2 giorni diversi conta 2) ma
// è il massimo che possiamo avere su range lunghi. Il caller può segnalare
// all'utente che il numero è "indicativo" via fallbackUsed.
export async function fetchDayTotals(gql, ig, sinceUnix, untilUnix) {
  const out = {};
  const errors = [];
  const fallbackUsed = [];
  // Strategia per metrica: prima tenta total_value (dedupe corretto ma max 30gg).
  // Se throw o null → fallback chunking: spezzetta il range in blocchi di
  // ~28gg e somma i total_value di ognuno. Approssima ma dà un numero robusto
  // anche per range lunghi.
  const CHUNK_SECS = 28 * 86400;

  const tryTotalValue = async (m, s, u) => {
    const j = await gql(
      `/${ig}/insights?metric=${m}&metric_type=total_value&period=day&since=${s}&until=${u}`
    );
    return j.data?.[0]?.total_value?.value ?? null;
  };

  const tryDailySum = async (m, s, u) => {
    const daily = await gql(
      `/${ig}/insights?metric=${m}&period=day&since=${s}&until=${u}`
    );
    const values = daily.data?.[0]?.values || [];
    if (values.length === 0) return null;
    return values.reduce((acc, v) => acc + (Number(v.value) || 0), 0);
  };

  const fetchChunked = async (m) => {
    // Spezza il range in finestre ≤28gg e somma le singole total_value
    let total = 0;
    let haveSome = false;
    let cursor = sinceUnix;
    while (cursor < untilUnix) {
      const end = Math.min(cursor + CHUNK_SECS, untilUnix);
      try {
        let v = await tryTotalValue(m, cursor, end);
        if (v == null) {
          v = await tryDailySum(m, cursor, end);
        }
        if (v != null) {
          total += Number(v);
          haveSome = true;
        }
      } catch {
        /* chunk fallito, skippalo */
      }
      cursor = end;
    }
    return haveSome ? total : null;
  };

  await Promise.all(
    METRICS_DAY.map(async (m) => {
      const spanSecs = untilUnix - sinceUnix;
      try {
        if (spanSecs <= 30 * 86400) {
          // Range breve: tenta total_value diretto
          let v = await tryTotalValue(m, sinceUnix, untilUnix);
          if (v == null) v = await tryDailySum(m, sinceUnix, untilUnix);
          out[m] = v;
        } else {
          // Range lungo: chunking sempre. total_value globale non è affidabile.
          const v = await fetchChunked(m);
          out[m] = v;
          if (v != null) fallbackUsed.push(m);
        }
      } catch (e) {
        // Ultimo tentativo: chunking
        try {
          const v = await fetchChunked(m);
          out[m] = v;
          if (v != null) fallbackUsed.push(m);
        } catch (e2) {
          errors.push(`${m}: ${e2.message}`);
          out[m] = null;
        }
      }
    })
  );
  return { totals: out, errors, fallbackUsed };
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
    token: (process.env.IG_PAGE_TOKEN || defaultConfig.TOKEN || "").trim(),
    pageId: (process.env.IG_PAGE_ID || defaultConfig.PAGE_ID || "").trim(),
    api: (
      process.env.IG_API ||
      defaultConfig.API ||
      "https://graph.facebook.com/v21.0"
    ).trim(),
  };
}
