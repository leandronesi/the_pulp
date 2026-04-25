// Formatters condivisi tra App.jsx e i sub-componenti estratti.
// Lingua: italiano. Edge case: null/NaN ritorna "—".

export const fmt = (n) => {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return Math.round(n).toLocaleString("it-IT");
};

export const fmtPct = (n) => {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(1) + "%";
};

export const fmtSignedPct = (n) => {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(0)}%`;
};

export const fmtDate = (d) =>
  new Date(d).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "short",
  });

export const daysAgoTs = (n) => Math.floor((Date.now() - n * 86400000) / 1000);

export const delta = (cur, prev) => {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
};
