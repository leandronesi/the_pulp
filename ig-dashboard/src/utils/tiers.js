// Tier classifiers + costanti UI condivise (label, colori, palette per tipo
// di contenuto, costanti per heatmap/legenda). Le soglie qui dentro sono
// allineate a `.claude/skills/pulp-briefing/references/benchmarks.md` —
// se le cambi qui, sincronizza anche la skill.

// ─── Tier classifiers ─────────────────────────────────────────────────────

// IG Engagement Rate (interactions/reach × 100).
export const erTier = (er) => {
  if (er == null || Number.isNaN(er)) return null;
  if (er > 6) return { label: "excellent", color: "#EDE5D0" };
  if (er >= 3) return { label: "good", color: "#7FB3A3" };
  if (er >= 1) return { label: "avg", color: "#D4A85C" };
  return { label: "poor", color: "#D98B6F" };
};

// Reach rate (reach/follower) per-post.
// viral >100% · strong 30–100% · normal 10–30% · low <10%
export const reachRateTier = (rate) => {
  if (rate == null || Number.isNaN(rate)) return null;
  if (rate > 100) return { label: "viral", color: "#EDE5D0" };
  if (rate >= 30) return { label: "strong", color: "#7FB3A3" };
  if (rate >= 10) return { label: "normal", color: "#D4A85C" };
  return { label: "low", color: "#D98B6F" };
};

// Save rate (saves/reach). 2026: top metrica per qualità contenuto.
// >2% excellent · 1–2% good · 0.5–1% avg · <0.5% poor
export const saveRateTier = (rate) => {
  if (rate == null || Number.isNaN(rate)) return null;
  if (rate > 2) return { label: "excellent", color: "#EDE5D0" };
  if (rate >= 1) return { label: "good", color: "#7FB3A3" };
  if (rate >= 0.5) return { label: "avg", color: "#D4A85C" };
  return { label: "poor", color: "#D98B6F" };
};

// Share rate (shares/reach). >1.5% excellent · 0.5–1.5% good · <0.5% avg
export const shareRateTier = (rate) => {
  if (rate == null || Number.isNaN(rate)) return null;
  if (rate > 1.5) return { label: "excellent", color: "#EDE5D0" };
  if (rate >= 0.5) return { label: "good", color: "#7FB3A3" };
  return { label: "avg", color: "#D4A85C" };
};

// Reel avg watch time in secondi. Tipica reel 15–30s; soglie pensate per
// account in nascita: >15s = la metà di un reel medio è guardata, segnale
// fortissimo. <4s = swipe-via, il gancio iniziale non funziona.
export const watchTimeTier = (sec) => {
  if (sec == null || Number.isNaN(sec)) return null;
  if (sec > 15) return { label: "excellent", color: "#EDE5D0" };
  if (sec >= 8) return { label: "good", color: "#7FB3A3" };
  if (sec >= 4) return { label: "avg", color: "#D4A85C" };
  return { label: "poor", color: "#D98B6F" };
};

// ─── Tier arrays per la Legenda ──────────────────────────────────────────
// Stesse soglie delle funzioni sopra, ordinate dal peggiore al migliore.

export const ER_TIERS_LEGEND = [
  { label: "poor", color: "#D98B6F", range: "<1%" },
  { label: "avg", color: "#D4A85C", range: "1–3%" },
  { label: "good", color: "#7FB3A3", range: "3–6%" },
  { label: "excellent", color: "#EDE5D0", range: ">6%" },
];

export const REACH_RATE_TIERS_LEGEND = [
  { label: "low", color: "#D98B6F", range: "<10%" },
  { label: "normal", color: "#D4A85C", range: "10–30%" },
  { label: "strong", color: "#7FB3A3", range: "30–100%" },
  { label: "viral", color: "#EDE5D0", range: ">100%" },
];

export const SAVE_RATE_TIERS_LEGEND = [
  { label: "poor", color: "#D98B6F", range: "<0.5%" },
  { label: "avg", color: "#D4A85C", range: "0.5–1%" },
  { label: "good", color: "#7FB3A3", range: "1–2%" },
  { label: "excellent", color: "#EDE5D0", range: ">2%" },
];

export const SHARE_RATE_TIERS_LEGEND = [
  { label: "avg", color: "#D4A85C", range: "<0.5%" },
  { label: "good", color: "#7FB3A3", range: "0.5–1.5%" },
  { label: "excellent", color: "#EDE5D0", range: ">1.5%" },
];

export const WATCH_TIME_TIERS_LEGEND = [
  { label: "poor", color: "#D98B6F", range: "<4s" },
  { label: "avg", color: "#D4A85C", range: "4–8s" },
  { label: "good", color: "#7FB3A3", range: "8–15s" },
  { label: "excellent", color: "#EDE5D0", range: ">15s" },
];

// ─── Palette media-type per UI ────────────────────────────────────────────
// (diverse da MEDIA_TYPE_BENCHMARKS in analytics.js — quelle sono numeri,
// queste sono label/colori per render).

export const MEDIA_TYPE_LABELS = {
  REELS: "Reels",
  VIDEO: "Video",
  IMAGE: "Foto",
  CAROUSEL_ALBUM: "Carousel",
};

export const MEDIA_TYPE_COLORS = {
  REELS: "#EDE5D0",
  VIDEO: "#B8823A",
  IMAGE: "#D4A85C",
  CAROUSEL_ALBUM: "#7FB3A3",
};

// Pallini-post sul chart Reach giornaliero (in StoriesStrip e tooltip).
// gold = formato di punta, sage = secondario, ecc.
export const POST_DOT_COLORS = {
  REELS: "#D4A85C",
  CAROUSEL_ALBUM: "#7FB3A3",
  IMAGE: "#EDE5D0",
  VIDEO: "#D98B6F",
};

export const POST_DOT_LABELS = {
  REELS: "Reel",
  CAROUSEL_ALBUM: "Carosello",
  IMAGE: "Foto",
  VIDEO: "Video",
};

// ─── Costanti heatmap ─────────────────────────────────────────────────────

export const DAYS_IT = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
export const HOUR_BUCKETS = ["00–04", "04–08", "08–12", "12–16", "16–20", "20–24"];
