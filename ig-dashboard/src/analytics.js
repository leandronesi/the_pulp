const DAY_MS = 86400000;

export const MEDIA_TYPE_BENCHMARKS = {
  REELS: { low: 1.5, high: 3.0, mid: 2.25 },
  CAROUSEL_ALBUM: { low: 1.1, high: 1.5, mid: 1.3 },
  IMAGE: { low: 0.7, high: 1.0, mid: 0.85 },
  VIDEO: { low: 0.5, high: 0.8, mid: 0.65 },
};

export const CURVE_TYPE_META = {
  front_loaded: { label: "front-loaded", color: "#EDE5D0" },
  steady: { label: "steady", color: "#7FB3A3" },
  slow_burn: { label: "slow-burn", color: "#D4A85C" },
  forming: { label: "forming", color: "#D98B6F" },
};

export const QUADRANT_META = {
  breakout: { label: "high reach / high ER", color: "#EDE5D0" },
  broadcast: { label: "high reach / low ER", color: "#B8823A" },
  sticky: { label: "low reach / high ER", color: "#7FB3A3" },
  weak: { label: "low reach / low ER", color: "#D98B6F" },
};

// Quadranti reel: views × watch medio (s). Stessa codifica colori di
// QUADRANT_META per affinità visiva ma label dedicati alla domanda reel
// ("è arrivato a tanti?" × "lo guardano davvero?").
export const REEL_WATCH_QUADRANT_META = {
  hit: { label: "alte views / alto watch", color: "#EDE5D0" },
  scroll: { label: "alte views / basso watch", color: "#B8823A" },
  retained: { label: "basse views / alto watch", color: "#7FB3A3" },
  miss: { label: "basse views / basso watch", color: "#D98B6F" },
};

export const metricOf = (post, name) =>
  post.insights?.data?.find((x) => x.name === name)?.values?.[0]?.value ?? 0;

export const postInteractions = (post) =>
  (post.like_count || 0) +
  (post.comments_count || 0) +
  metricOf(post, "saved") +
  metricOf(post, "shares");

export function normalizeMediaType(type) {
  return MEDIA_TYPE_BENCHMARKS[type] ? type : "IMAGE";
}

// Meta puo` restituire i Reel come media_type=VIDEO. Quando disponibile,
// media_product_type=REELS e` il segnale piu` affidabile; per lo storico DB,
// dove abbiamo solo media_type + permalink, usiamo /reel/ come fallback.
export function resolveMediaType(post = {}) {
  const mediaType = String(post.media_type || post.mediaType || "").toUpperCase();
  const mediaProductType = String(
    post.media_product_type || post.mediaProductType || ""
  ).toUpperCase();
  const permalink = String(post.permalink || "");

  if (mediaProductType === "REELS") return "REELS";
  if (mediaType === "REELS") return "REELS";
  if (mediaType === "VIDEO" && /\/reel\//i.test(permalink)) return "REELS";
  return normalizeMediaType(mediaType);
}

export function isVideoLikeMedia(post = {}) {
  const type = resolveMediaType(post);
  return type === "VIDEO" || type === "REELS";
}

function average(values) {
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function median(values) {
  const sorted = values
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function quantile(values, q) {
  const sorted = values
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function safeRatio(num, den) {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return num / den;
}

function interpolate(history, targetMs, key) {
  if (!Array.isArray(history) || !history.length) return 0;

  const sorted = [...history].sort((a, b) => a.t - b.t);
  if (targetMs <= sorted[0].t) return Number(sorted[0][key]) || 0;

  const last = sorted[sorted.length - 1];
  if (targetMs >= last.t) return Number(last[key]) || 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    if (targetMs <= next.t) {
      const span = next.t - prev.t || 1;
      const progress = (targetMs - prev.t) / span;
      const prevVal = Number(prev[key]) || 0;
      const nextVal = Number(next[key]) || 0;
      return prevVal + (nextVal - prevVal) * progress;
    }
  }

  return Number(last[key]) || 0;
}

function estimateObservedDays(post, history) {
  const publishMs = new Date(post.timestamp).getTime();
  if (!Number.isFinite(publishMs)) return 1;

  const lastObservedMs =
    Array.isArray(history) && history.length
      ? Number(history[history.length - 1].t) || Date.now()
      : Date.now();

  return Math.max(
    1,
    Math.min(7, Math.floor((lastObservedMs - publishMs) / DAY_MS) + 1)
  );
}

export function buildLifecycleSeries(post, history, maxDays = 7) {
  if (!Array.isArray(history) || history.length < 2) return [];

  const publishMs = new Date(post.timestamp).getTime();
  if (!Number.isFinite(publishMs)) return [];

  const sorted = [...history].sort((a, b) => a.t - b.t);
  const lastObservedMs = Number(sorted[sorted.length - 1].t) || publishMs;
  const observedDays = Math.max(
    1,
    Math.min(maxDays, Math.floor((lastObservedMs - publishMs) / DAY_MS) + 1)
  );

  const series = [];
  for (let day = 1; day <= observedDays; day++) {
    const targetMs = Math.min(publishMs + day * DAY_MS, lastObservedMs);
    const reach = Math.round(interpolate(sorted, targetMs, "reach"));
    const saved = Math.round(interpolate(sorted, targetMs, "saved"));
    series.push({
      day,
      label: `g${day}`,
      reach,
      saved,
    });
  }

  const finalReach = series[series.length - 1]?.reach || 0;
  const finalSaved = series[series.length - 1]?.saved || 0;

  return series.map((point) => ({
    ...point,
    reachPct: finalReach > 0 ? (point.reach / finalReach) * 100 : 0,
    savedPct: finalSaved > 0 ? (point.saved / finalSaved) * 100 : 0,
  }));
}

export function classifyCurveType(series) {
  if (!Array.isArray(series) || !series.length) return "forming";
  if (series.length < 3) return "forming";

  const day2 = series[Math.min(1, series.length - 1)];
  const day3 = series[Math.min(2, series.length - 1)];
  const final = series[series.length - 1];
  const earlyPct = day2?.reachPct ?? 0;
  const midPct = day3?.reachPct ?? 0;
  const tailGrowth = safeRatio(final.reach, Math.max(day3?.reach || 0, 1)) || 1;

  if (earlyPct >= 72 || midPct >= 86) return "front_loaded";
  if (earlyPct <= 48 && tailGrowth >= 1.4) return "slow_burn";
  return "steady";
}

export function derivePostAnalytics(posts, postHistory = {}, account = null) {
  const basePosts = (posts || []).map((post) => {
    const reach = metricOf(post, "reach");
    const saved = metricOf(post, "saved");
    const shares = metricOf(post, "shares");
    const views = metricOf(post, "views");
    const interactions = postInteractions(post);
    const er = reach > 0 ? (interactions / reach) * 100 : 0;
    return {
      post,
      id: post.id,
      mediaType: resolveMediaType(post),
      reach,
      saved,
      shares,
      views,
      interactions,
      er,
    };
  });

  const followersCount = Number(account?.followers_count) || null;

  return Object.fromEntries(
    basePosts.map((base) => {
      const history = postHistory?.[base.id] || [];
      const lifecycleSeries = buildLifecycleSeries(base.post, history, 7);
      const observedDays =
        lifecycleSeries.length || estimateObservedDays(base.post, history);
      const reachInWindow = lifecycleSeries[lifecycleSeries.length - 1]?.reach ?? base.reach;
      const savedInWindow = lifecycleSeries[lifecycleSeries.length - 1]?.saved ?? base.saved;

      return [
        base.id,
        {
          id: base.id,
          mediaType: base.mediaType,
          reach: base.reach,
          saved: base.saved,
          shares: base.shares,
          views: base.views,
          interactions: base.interactions,
          er: base.er,
          observedDays,
          velocity7d: safeRatio(reachInWindow, observedDays),
          saveVelocity7d: safeRatio(savedInWindow, observedDays),
          reachRate: safeRatio(base.reach, followersCount)
            ? safeRatio(base.reach, followersCount) * 100
            : null,
          lifecycleSeries,
          curveType: classifyCurveType(lifecycleSeries),
        },
      ];
    })
  );
}

export function deriveContentMix(posts) {
  const buckets = {};
  Object.keys(MEDIA_TYPE_BENCHMARKS).forEach((type) => {
    buckets[type] = {
      type,
      count: 0,
      reachSum: 0,
      interSum: 0,
      velocitySum: 0,
      velocityCount: 0,
      outlierCount: 0,
    };
  });

  for (const post of posts || []) {
    const type = resolveMediaType(post);
    const bucket = buckets[type];
    bucket.count += 1;
    bucket.reachSum += Number(post.reach) || 0;
    bucket.interSum += Number(post.interactions) || 0;
    if (Number.isFinite(post.velocity7d)) {
      bucket.velocitySum += post.velocity7d;
      bucket.velocityCount += 1;
    }
    if (post.outlierFlag) bucket.outlierCount += 1;
  }

  return Object.values(buckets).map((bucket) => ({
    type: bucket.type,
    count: bucket.count,
    avgReach: bucket.count ? bucket.reachSum / bucket.count : 0,
    avgEr: bucket.reachSum ? (bucket.interSum / bucket.reachSum) * 100 : 0,
    avgVelocity: bucket.velocityCount ? bucket.velocitySum / bucket.velocityCount : 0,
    outlierCount: bucket.outlierCount,
  }));
}

export function deriveScatterMeta(posts) {
  if (!Array.isArray(posts) || !posts.length) {
    return {
      reachMedian: 0,
      erMedian: 0,
      quadrants: [],
      byId: {},
      outlierCount: 0,
    };
  }

  const reachValues = posts.map((post) => Number(post.reach) || 0);
  const erValues = posts.map((post) => Number(post.er) || 0);
  const reachMedian = median(reachValues);
  const erMedian = median(erValues);

  const q1Reach = quantile(reachValues, 0.25);
  const q3Reach = quantile(reachValues, 0.75);
  const q1Er = quantile(erValues, 0.25);
  const q3Er = quantile(erValues, 0.75);
  const reachThreshold = q3Reach + (q3Reach - q1Reach) * 1.5;
  const erThreshold = q3Er + (q3Er - q1Er) * 1.25;

  const quadrantCounts = {
    breakout: 0,
    broadcast: 0,
    sticky: 0,
    weak: 0,
  };
  const byId = {};

  for (const post of posts) {
    const quadrant =
      post.reach >= reachMedian
        ? post.er >= erMedian
          ? "breakout"
          : "broadcast"
        : post.er >= erMedian
        ? "sticky"
        : "weak";

    const outlierFlag =
      (post.reach >= reachThreshold && post.er >= erMedian) ||
      (post.er >= erThreshold && post.reach >= reachMedian);

    quadrantCounts[quadrant] += 1;
    byId[post.id] = { quadrant, outlierFlag };
  }

  return {
    reachMedian,
    erMedian,
    outlierCount: Object.values(byId).filter((meta) => meta.outlierFlag).length,
    quadrants: Object.entries(quadrantCounts)
      .map(([key, count]) => ({
        key,
        count,
        ...QUADRANT_META[key],
      }))
      .filter((row) => row.count > 0),
    byId,
  };
}

// Quadranti per scatter reel-specifico (views × watch medio in secondi).
// Aspetta in input punti {id, views, avgWatchSec}. Mediane come split
// + threshold Tukey 1.5·IQR per evidenziare outlier "good".
export function deriveReelWatchMeta(points) {
  if (!Array.isArray(points) || !points.length) {
    return {
      viewsMedian: 0,
      watchMedian: 0,
      quadrants: [],
      byId: {},
      outlierCount: 0,
    };
  }

  const viewsValues = points.map((p) => Number(p.views) || 0);
  const watchValues = points.map((p) => Number(p.avgWatchSec) || 0);
  const viewsMedian = median(viewsValues);
  const watchMedian = median(watchValues);

  const q1V = quantile(viewsValues, 0.25);
  const q3V = quantile(viewsValues, 0.75);
  const q1W = quantile(watchValues, 0.25);
  const q3W = quantile(watchValues, 0.75);
  const viewsThreshold = q3V + (q3V - q1V) * 1.5;
  const watchThreshold = q3W + (q3W - q1W) * 1.25;

  const counts = { hit: 0, scroll: 0, retained: 0, miss: 0 };
  const byId = {};

  for (const p of points) {
    const quadrant =
      p.views >= viewsMedian
        ? p.avgWatchSec >= watchMedian
          ? "hit"
          : "scroll"
        : p.avgWatchSec >= watchMedian
        ? "retained"
        : "miss";
    const outlierFlag =
      (p.views >= viewsThreshold && p.avgWatchSec >= watchMedian) ||
      (p.avgWatchSec >= watchThreshold && p.views >= viewsMedian);
    counts[quadrant] += 1;
    byId[p.id] = { quadrant, outlierFlag };
  }

  return {
    viewsMedian,
    watchMedian,
    outlierCount: Object.values(byId).filter((m) => m.outlierFlag).length,
    quadrants: Object.entries(counts)
      .map(([key, count]) => ({ key, count, ...REEL_WATCH_QUADRANT_META[key] }))
      .filter((row) => row.count > 0),
    byId,
  };
}
