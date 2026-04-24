// Briefing generator — legge Turso, calcola aggregati, produce markdown.
//
// Scaffold della skill `pulp-briefing` (workflow 7-step):
//   1. Validate data availability
//   2. Current period aggregates
//   3. Previous period aggregates (same length)
//   4. Identify outliers (hero + bottom)
//   5. Benchmark (tier IG)
//   6. Brand voice synthesis    ← placeholder per LLM (vedi sotto)
//   7. Draft report
//
// Lo step 6 (narrative) richiede LLM — per ora lascio `_[...]_` placeholder.
// Implementazione Claude API arriverà in una iterazione successiva.
//
// Uso:
//   npm run briefing                → settimanale (7d), output in reports/
//   npm run briefing -- --period=30d --output=stdout
//
// Flag supportati:
//   --period=7d|14d|30d|90d   default 7d
//   --output=file|stdout       default file

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getDb, todayIsoDate, startRunLog, endRunLog } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = resolve(__dirname, "..", "..", "reports");

// ─── CLI parsing ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argOf = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const period = argOf("period", "7d");
const outputMode = argOf("output", "file");

const DAYS = parseInt(period.replace(/\D/g, ""), 10);
if (![7, 14, 30, 90].includes(DAYS)) {
  console.error(`Period non supportato: ${period}. Usa 7d | 14d | 30d | 90d.`);
  process.exit(1);
}
if (!["file", "stdout"].includes(outputMode)) {
  console.error(`Output non supportato: ${outputMode}. Usa file | stdout.`);
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────
const fmtN = (n) => (n == null ? "—" : Math.round(Number(n)).toLocaleString("it-IT"));
const pct = (n) => (n == null || Number.isNaN(n) ? "—" : n.toFixed(1) + "%");

function erTier(er) {
  if (er == null || Number.isNaN(er)) return null;
  if (er > 6) return "excellent";
  if (er >= 3) return "good";
  if (er >= 1) return "avg";
  return "poor";
}

function deltaStr(cur, prev, { unit = "%" } = {}) {
  if (cur == null || prev == null || prev === 0) return "—";
  const d = ((cur - prev) / prev) * 100;
  const arrow = Math.abs(d) < 2 ? "=" : d > 0 ? "↑" : "↓";
  return `${arrow} ${Math.abs(d).toFixed(1)}${unit}`;
}

function daysAgoIsoDate(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─── Data access (Turso) ──────────────────────────────────────────────────

async function getPeriodAggregates(db, sinceDate, untilDate) {
  const res = await db.execute({
    sql: `SELECT date, followers_count, follows_count, media_count,
                 reach, profile_views, accounts_engaged, total_interactions
          FROM daily_snapshot
          WHERE date BETWEEN ? AND ?
          ORDER BY date ASC`,
    args: [sinceDate, untilDate],
  });
  if (res.rows.length === 0) return null;

  const num = (x) => (x == null ? 0 : Number(x));
  const totals = res.rows.reduce(
    (acc, r) => ({
      reach: acc.reach + num(r.reach),
      interactions: acc.interactions + num(r.total_interactions),
      engaged: acc.engaged + num(r.accounts_engaged),
      profile_views: acc.profile_views + num(r.profile_views),
    }),
    { reach: 0, interactions: 0, engaged: 0, profile_views: 0 }
  );

  const first = res.rows[0];
  const last = res.rows[res.rows.length - 1];
  return {
    totals,
    followersStart: num(first.followers_count),
    followersEnd: num(last.followers_count),
    followersDelta: num(last.followers_count) - num(first.followers_count),
    mediaStart: num(first.media_count),
    mediaEnd: num(last.media_count),
    daysCovered: res.rows.length,
    firstDate: first.date,
    lastDate: last.date,
  };
}

async function getPostsInPeriod(db, sinceIso, untilIso) {
  const res = await db.execute({
    sql: `SELECT p.post_id, p.timestamp, p.media_type, p.caption, p.permalink
          FROM post p
          WHERE p.timestamp >= ? AND p.timestamp < ?
          ORDER BY p.timestamp DESC`,
    args: [sinceIso, untilIso],
  });
  if (res.rows.length === 0) return [];

  const ids = res.rows.map((r) => r.post_id);
  const placeholders = ids.map(() => "?").join(",");
  const latest = await db.execute({
    sql: `SELECT post_id, fetched_at, like_count, comments_count, reach, saved, shares, views
          FROM post_snapshot
          WHERE post_id IN (${placeholders})`,
    args: ids,
  });

  // keep only latest snapshot per post
  const latestByPost = {};
  for (const s of latest.rows) {
    const cur = latestByPost[s.post_id];
    if (!cur || Number(s.fetched_at) > Number(cur.fetched_at)) {
      latestByPost[s.post_id] = s;
    }
  }

  return res.rows.map((r) => {
    const s = latestByPost[r.post_id] || {};
    const reach = Number(s.reach) || 0;
    const like = Number(s.like_count) || 0;
    const comments = Number(s.comments_count) || 0;
    const saved = Number(s.saved) || 0;
    const shares = Number(s.shares) || 0;
    const views = Number(s.views) || 0;
    const interactions = like + comments + saved + shares;
    const er = reach > 0 ? (interactions / reach) * 100 : 0;
    return {
      postId: r.post_id,
      timestamp: r.timestamp,
      mediaType: r.media_type,
      caption: r.caption || "",
      permalink: r.permalink || "",
      reach,
      like,
      comments,
      saved,
      shares,
      views,
      interactions,
      er,
    };
  });
}

// ─── Report assembly ──────────────────────────────────────────────────────

function renderBriefing({ periodLabel, sinceDate, untilDate, days, current, prev, posts }) {
  const lines = [];

  const erCurrent =
    current.totals.reach > 0
      ? (current.totals.interactions / current.totals.reach) * 100
      : null;
  const erPrev =
    prev && prev.totals.reach > 0
      ? (prev.totals.interactions / prev.totals.reach) * 100
      : null;

  lines.push(`# The Pulp · Briefing ${periodLabel} · ${sinceDate} – ${untilDate}`);
  lines.push("");
  lines.push(
    `**Generato**: ${new Date().toLocaleString("it-IT", { timeZone: "Europe/Rome" })}  `
  );
  lines.push(
    `**Finestra**: ${days} giorni (${current.daysCovered} snapshot daily disponibili) · **Post nel periodo**: ${posts.length}`
  );
  lines.push("");

  if (current.daysCovered < 3 || posts.length < 2) {
    lines.push(
      `> ⚠ **Sample piccolo** — solo ${current.daysCovered} giorni di snapshot e ${posts.length} post nel periodo. Le conclusioni sono indicative. L'archivio si riempie automaticamente (cron 4h + daily) e i briefing futuri saranno più robusti.`
    );
    lines.push("");
  }

  // Headline
  lines.push("## Headline");
  lines.push("");
  lines.push(
    "_[da generare con LLM sui dati sotto — frase di apertura sintetica]_"
  );
  lines.push("");

  // Numeri
  lines.push("## Numeri");
  lines.push("");
  lines.push(
    `- **Reach**: ${fmtN(current.totals.reach)} (${deltaStr(
      current.totals.reach,
      prev?.totals?.reach
    )} vs prec.)`
  );
  if (erCurrent != null) {
    const tier = erTier(erCurrent);
    lines.push(
      `- **Engagement rate**: ${pct(erCurrent)} (${deltaStr(
        erCurrent,
        erPrev
      )}${tier ? ` · tier **${tier}**` : ""})`
    );
  } else {
    lines.push(`- **Engagement rate**: — (reach = 0 nel periodo)`);
  }
  lines.push(
    `- **Accounts engaged**: ${fmtN(current.totals.engaged)} (${deltaStr(
      current.totals.engaged,
      prev?.totals?.engaged
    )})`
  );
  lines.push(
    `- **Profile views**: ${fmtN(current.totals.profile_views)} (${deltaStr(
      current.totals.profile_views,
      prev?.totals?.profile_views
    )})`
  );
  lines.push(
    `- **Follower**: ${fmtN(current.followersEnd)} (netti nel periodo: ${
      current.followersDelta >= 0 ? "+" : ""
    }${current.followersDelta})`
  );
  lines.push("");

  // Hero
  const heroPost = posts.length > 0 ? [...posts].sort((a, b) => b.reach - a.reach)[0] : null;
  lines.push("## Hero del periodo");
  lines.push("");
  if (heroPost) {
    const when = new Date(heroPost.timestamp).toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "long",
    });
    const cap = heroPost.caption.slice(0, 120);
    lines.push(`**${heroPost.mediaType} del ${when}**`);
    lines.push("");
    if (cap) lines.push(`> ${cap}${heroPost.caption.length > 120 ? "…" : ""}`);
    lines.push("");
    lines.push(`- Reach: **${fmtN(heroPost.reach)}**`);
    lines.push(
      `- ER: **${pct(heroPost.er)}**${erTier(heroPost.er) ? ` (tier ${erTier(heroPost.er)})` : ""}`
    );
    lines.push(
      `- Like: ${heroPost.like} · Commenti: ${heroPost.comments} · Saved: ${heroPost.saved} · Shares: ${heroPost.shares}`
    );
    if (heroPost.permalink) lines.push(`- [Vai al post](${heroPost.permalink})`);
    lines.push("");
    lines.push(
      "_[analisi del perché ha funzionato — LLM legge contesto post + benchmark periodo, produce 2-4 righe]_"
    );
    lines.push("");
  } else {
    lines.push("Nessun post pubblicato nel periodo.");
    lines.push("");
  }

  // Sotto-media
  const bottomCandidates = posts.filter((p) => p.reach >= 200);
  if (bottomCandidates.length >= 2) {
    const bottomPost = [...bottomCandidates].sort((a, b) => a.er - b.er)[0];
    if (bottomPost && bottomPost.postId !== heroPost?.postId) {
      lines.push("## Sotto-media");
      lines.push("");
      const when = new Date(bottomPost.timestamp).toLocaleDateString("it-IT", {
        day: "2-digit",
        month: "long",
      });
      const cap = bottomPost.caption.slice(0, 120);
      lines.push(`**${bottomPost.mediaType} del ${when}**`);
      lines.push("");
      if (cap) lines.push(`> ${cap}${bottomPost.caption.length > 120 ? "…" : ""}`);
      lines.push("");
      lines.push(`- Reach: ${fmtN(bottomPost.reach)}`);
      lines.push(
        `- ER: ${pct(bottomPost.er)}${erTier(bottomPost.er) ? ` (tier ${erTier(bottomPost.er)})` : ""}`
      );
      lines.push(
        `- Like: ${bottomPost.like} · Commenti: ${bottomPost.comments} · Saved: ${bottomPost.saved} · Shares: ${bottomPost.shares}`
      );
      if (bottomPost.permalink) lines.push(`- [Vai al post](${bottomPost.permalink})`);
      lines.push("");
      lines.push("_[analisi del perché ha tenuto un ER basso — LLM]_");
      lines.push("");
    }
  }

  // Pattern osservati (calcolati, non LLM)
  lines.push("## Pattern osservati");
  lines.push("");
  if (posts.length === 0) {
    lines.push(
      "- Nessun post nel periodo — pattern non calcolabili sui contenuti."
    );
  } else {
    const byType = {};
    for (const p of posts) {
      if (!byType[p.mediaType])
        byType[p.mediaType] = { count: 0, reach: 0, interactions: 0 };
      byType[p.mediaType].count += 1;
      byType[p.mediaType].reach += p.reach;
      byType[p.mediaType].interactions += p.interactions;
    }
    const typeRows = Object.entries(byType).map(([t, v]) => {
      const avgReach = v.reach / v.count;
      const avgEr = v.reach > 0 ? (v.interactions / v.reach) * 100 : 0;
      return { t, count: v.count, avgReach, avgEr };
    });
    typeRows.sort((a, b) => b.avgReach - a.avgReach);
    lines.push("**Per tipo di contenuto** (reach medio, ER medio):");
    lines.push("");
    for (const r of typeRows) {
      lines.push(
        `- **${r.t}** × ${r.count}: reach medio ${fmtN(r.avgReach)}, ER medio ${pct(r.avgEr)}`
      );
    }
    lines.push("");
  }

  // Actions
  lines.push("## Azioni per il prossimo periodo");
  lines.push("");
  lines.push(
    "_[3 azioni concrete con format: **cosa** → **perché** (dati) → **come misurare** · generate da LLM sui pattern sopra, regole in [.claude/skills/pulp-briefing/references/brand-context.md](../../.claude/skills/pulp-briefing/references/brand-context.md) sezione 'Format delle recommendation nelle Azioni']_"
  );
  lines.push("");

  // Method notes
  lines.push("## Note di metodo");
  lines.push("");
  lines.push(`- Finestra: ${days}gg (${sinceDate} → ${untilDate})`);
  lines.push(`- Snapshot daily coperti: ${current.daysCovered}`);
  lines.push(
    `- Reach è **somma dei valori giornalieri**, non deduplicato cross-day. Per un valore deduplicato bisogna chiamare la Graph API con \`total_value\` sul range — non fatto qui per mantenere il briefing self-contained su Turso. Vedi [wiki/concepts/reach-deduplication.md](../../wiki/concepts/reach-deduplication.md).`
  );
  lines.push(
    `- ER calcolato come \`interactions/reach\` sul totale periodo (non come media di ER per-post).`
  );
  lines.push(
    `- Post "sotto-media" selezionato tra quelli con reach ≥ 200 per filtrare rumore.`
  );
  lines.push("");

  lines.push("---");
  lines.push(
    `_Generato da scripts/briefing.js (v0.1 · scaffold). Le sezioni con \`_[placeholder]_\` sono da completare con analisi LLM (integrazione Anthropic API in iterazione successiva)._`
  );
  lines.push("");

  return lines.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const db = await getDb();
  const runId = await startRunLog("briefing");

  try {
    const untilDate = todayIsoDate();
    const sinceDate = daysAgoIsoDate(DAYS);
    const sincePrevDate = daysAgoIsoDate(2 * DAYS);
    const untilPrevDate = sinceDate;

    const current = await getPeriodAggregates(db, sinceDate, untilDate);
    if (!current) {
      const msg = `Nessun daily_snapshot nel range ${sinceDate} → ${untilDate}. Lancia 'npm run snapshot' o aspetta che i cron GH Actions accumulino dati.`;
      console.error(msg);
      await endRunLog(runId, { status: "error", error: msg });
      process.exit(1);
    }

    const prev = await getPeriodAggregates(db, sincePrevDate, untilPrevDate);
    const posts = await getPostsInPeriod(
      db,
      sinceDate + "T00:00:00+0000",
      untilDate + "T23:59:59+0000"
    );

    const label = DAYS === 7 ? "settimanale" : DAYS === 30 ? "mensile" : `${DAYS}g`;
    const markdown = renderBriefing({
      periodLabel: label,
      sinceDate,
      untilDate,
      days: DAYS,
      current,
      prev,
      posts,
    });

    if (outputMode === "stdout") {
      process.stdout.write(markdown);
    } else {
      mkdirSync(REPORTS_DIR, { recursive: true });
      const filename = `briefing-${untilDate}-${DAYS}d.md`;
      const filepath = resolve(REPORTS_DIR, filename);
      writeFileSync(filepath, markdown);
      console.log(`OK briefing → ${filepath} (${markdown.length} chars)`);
      console.log(
        `Periodo: ${sinceDate} → ${untilDate} · ${current.daysCovered} snapshot daily · ${posts.length} post`
      );
    }

    await endRunLog(runId, {
      status: "ok",
      summary: JSON.stringify({
        period: DAYS,
        days_covered: current.daysCovered,
        posts_count: posts.length,
        reach_total: current.totals.reach,
      }),
    });
  } catch (err) {
    console.error(`KO briefing: ${err.message}`);
    await endRunLog(runId, { status: "error", error: err.message });
    process.exit(1);
  }
}

main();
