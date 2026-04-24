// Dati fake per lavorare sul dashboard senza un token valido.
// Si attiva automaticamente quando TOKEN in config.js è vuoto.

// PRNG seeded (mulberry32) — così le grandezze cambiano tra 7/30/90g ma
// non saltellano ad ogni re-render. Seed = base + dateRange.
const seeded = (s) => () => {
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const CAPTIONS = [
  "Ep 3 · Il soave è una promessa che il vento non si dimentica",
  "Tramonti sopra i vigneti di Monteforte. Bicchiere alla mano.",
  "Dietro le quinte della vendemmia 2025 — grazie a chi c'era",
  "Tre note che ti cambiano la sera, raccontate in sessanta secondi",
  "Una bottiglia, due mani, un pensiero che vale tutto il giro",
  "Il vino è anche la strada che hai fatto per arrivarci",
  "Nuovo episodio venerdì alle 18. Siate pronti a prendere appunti.",
  "Il mio taccuino di degustazione una settimana dopo. Spoiler: confermo.",
  "Incontri, cantine, chilometri. Questo mese è stato denso.",
  "Ospite speciale domenica. Se non la seguite già, recuperate.",
  "Il colore di questo Soave è un'eresia gentile",
  "Scatto rubato dietro al furgone. La vera vita sta qui.",
  "Un brindisi non è mai solo un brindisi",
  "Quando il calice parla prima del naso",
  "Pillole di degustazione, versione espressa",
];

const MEDIA_TYPES = [
  "REELS",
  "REELS",
  "REELS",
  "IMAGE",
  "CAROUSEL_ALBUM",
  "VIDEO",
  "IMAGE",
  "CAROUSEL_ALBUM",
];

function pickCurveType(type, rnd) {
  const roll = rnd();
  if (type === "REELS") {
    if (roll < 0.58) return "front_loaded";
    if (roll < 0.88) return "steady";
    return "slow_burn";
  }
  if (type === "CAROUSEL_ALBUM") {
    if (roll < 0.2) return "front_loaded";
    if (roll < 0.62) return "steady";
    return "slow_burn";
  }
  if (type === "VIDEO") {
    if (roll < 0.46) return "front_loaded";
    if (roll < 0.82) return "steady";
    return "slow_burn";
  }
  if (roll < 0.14) return "front_loaded";
  if (roll < 0.52) return "steady";
  return "slow_burn";
}

function growthProgress(curveType, t) {
  if (curveType === "front_loaded") return 1 - Math.exp(-6.4 * t);
  if (curveType === "slow_burn") return Math.pow(t, 1.55);
  return 1 - Math.exp(-3.7 * t);
}

export function generateFakeData(dateRange) {
  const rnd = seeded(42 + dateRange * 17);
  const r = (min, max) => min + rnd() * (max - min);
  const ri = (min, max) => Math.floor(r(min, max));

  const account = {
    username: "thepulp_demo",
    name: "The Pulp · demo mode",
    biography: "Soave sia il vento. Dati fake per sviluppo.",
    profile_picture_url: "/logo-mark.jpeg",
    followers_count: 3847,
    follows_count: 421,
    media_count: 186,
  };

  // Totali periodo corrente — scalano col range. Leggero boost sul corrente
  // vs precedente così i delta risultano in parte positivi in parte no.
  const baseReach = 520 * dateRange;
  const totals = {
    reach: ri(baseReach * 0.9, baseReach * 1.2),
    profile_views: ri(baseReach * 0.12, baseReach * 0.22),
    website_clicks: 0, // tenuto a 0 per vedere il behavior "nascondi se 0"
    accounts_engaged: ri(baseReach * 0.14, baseReach * 0.24),
    total_interactions: ri(baseReach * 0.11, baseReach * 0.18),
  };
  const totalsPrev = {
    reach: ri(baseReach * 0.7, baseReach * 1.1),
    profile_views: ri(baseReach * 0.1, baseReach * 0.2),
    website_clicks: 0,
    accounts_engaged: ri(baseReach * 0.1, baseReach * 0.2),
    total_interactions: ri(baseReach * 0.09, baseReach * 0.15),
  };

  // Reach giornaliero — dateRange punti, con weekend boost
  const now = Date.now();
  const reachDaily = [];
  for (let i = dateRange - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    const dow = d.getDay();
    const weekendBoost = dow === 0 || dow === 6 ? ri(250, 600) : 0;
    const trend = Math.max(0, dateRange - i) / dateRange; // leggero trend crescente
    reachDaily.push({
      value: ri(180, 680) + weekendBoost + Math.floor(trend * 200),
      end_time: d.toISOString(),
    });
  }

  // Post — sparsi nel range, circa 0.6 post/giorno, capped a 24
  const postCount = Math.min(24, Math.max(6, Math.floor(dateRange * 0.6)));
  const posts = [];
  const curveByPostId = {};
  for (let i = 0; i < postCount; i++) {
    const id = `fake_${i}_${dateRange}`;
    const type = MEDIA_TYPES[ri(0, MEDIA_TYPES.length)];
    const curveType = pickCurveType(type, rnd);
    const daysBack = r(0.1, dateRange);
    // Distribuisci ore su tutto il giorno ma con skew verso sera/weekend
    const hourSkew = rnd() < 0.55 ? ri(17, 23) : ri(7, 22);
    const ts = new Date(now - daysBack * 86400000);
    ts.setHours(hourSkew, ri(0, 60), 0, 0);

    const surpriseBoost = rnd() < 0.12 ? r(1.55, 2.35) : r(0.82, 1.12);
    const baseReachPost = Math.floor(
      (type === "REELS"
        ? ri(1400, 5200)
        : type === "VIDEO"
        ? ri(700, 2400)
        : ri(350, 1900)) * surpriseBoost
    );
    const like_count = Math.floor(baseReachPost * r(0.045, 0.13));
    const comments_count = Math.max(
      0,
      Math.floor(like_count * r(0.04, 0.22))
    );
    const saved = Math.floor(baseReachPost * r(0.012, 0.08));
    const shares = Math.floor(baseReachPost * r(0.006, 0.045));
    const views =
      type === "REELS" || type === "VIDEO"
        ? baseReachPost * ri(2, 5)
        : baseReachPost;

    posts.push({
      id,
      caption: CAPTIONS[i % CAPTIONS.length],
      media_type: type,
      media_url: `https://picsum.photos/seed/pulp-${i}-${dateRange}/600/600`,
      thumbnail_url:
        type === "REELS" || type === "VIDEO"
          ? `https://picsum.photos/seed/pulp-${i}-${dateRange}/600/600`
          : null,
      permalink: "https://instagram.com/thepulp_demo",
      timestamp: ts.toISOString(),
      like_count,
      comments_count,
      insights: {
        data: [
          { name: "reach", values: [{ value: baseReachPost }] },
          { name: "saved", values: [{ value: saved }] },
          { name: "shares", values: [{ value: shares }] },
          { name: "views", values: [{ value: views }] },
        ],
      },
    });
    curveByPostId[id] = curveType;
  }
  posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Histories simulate: per ogni post generiamo ~15 punti sulla curva di
  // crescita dal publish ad ora, con pattern sigmoide (crescita rapida nelle
  // prime 24-48h poi plateau).
  const postHistory = {};
  for (const p of posts) {
    const publishMs = new Date(p.timestamp).getTime();
    const nowMs = now;
    const span = nowMs - publishMs;
    if (span < 3600000) continue; // < 1h, no curva sensata
    const points = 14;
    const reachFinal = p.insights.data.find((x) => x.name === "reach").values[0]
      .value;
    const likesFinal = p.like_count;
    const savedFinal = p.insights.data.find((x) => x.name === "saved").values[0]
      .value;
    const sharesFinal = p.insights.data.find((x) => x.name === "shares")
      .values[0].value;
    const viewsFinal = p.insights.data.find((x) => x.name === "views").values[0]
      .value;
    const history = [];
    const curveType = curveByPostId[p.id] || "steady";
    for (let i = 0; i < points; i++) {
      const t = i / (points - 1);
      const progress = Math.min(1, growthProgress(curveType, t));
      const ts = publishMs + t * span;
      history.push({
        t: Math.floor(ts),
        reach: Math.floor(reachFinal * progress),
        likes: Math.floor(likesFinal * progress),
        comments: Math.floor((p.comments_count || 0) * progress),
        saved: Math.floor(savedFinal * progress),
        shares: Math.floor(sharesFinal * progress),
        views: Math.floor(viewsFinal * progress),
      });
    }
    postHistory[p.id] = history;
  }

  // Follower trend fake — un punto al giorno con leggera salita
  const followerTrend = [];
  const endFollowers = account.followers_count;
  for (let i = dateRange - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    const daysAgo = i;
    followerTrend.push({
      date: d.toISOString().slice(0, 10),
      followers: endFollowers - Math.floor(daysAgo * r(0.3, 1.2)),
      follows: account.follows_count,
      reach: ri(100, 900),
      engaged: ri(20, 150),
      interactions: ri(10, 80),
    });
  }

  // Audience (lifetime, non cambia con range)
  const audience = {
    age: [
      { key: "18-24", value: 168 },
      { key: "25-34", value: 421 },
      { key: "35-44", value: 294 },
      { key: "45-54", value: 137 },
      { key: "55-64", value: 71 },
      { key: "65+", value: 23 },
    ],
    gender: [
      { key: "F", value: 648 },
      { key: "M", value: 392 },
      { key: "U", value: 18 },
    ],
    city: [
      { key: "Milano", value: 193 },
      { key: "Roma", value: 148 },
      { key: "Verona", value: 101 },
      { key: "Torino", value: 87 },
      { key: "Bologna", value: 72 },
      { key: "Padova", value: 54 },
    ],
    country: [
      { key: "IT", value: 901 },
      { key: "CH", value: 42 },
      { key: "FR", value: 26 },
      { key: "DE", value: 17 },
    ],
  };

  return {
    account,
    totals,
    totalsPrev,
    reachDaily,
    posts,
    audience,
    postHistory,
    followerTrend,
  };
}

export const isFakeToken = (token) =>
  !token || token.trim() === "" || token.startsWith("PASTE");
