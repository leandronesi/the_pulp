// Deep report — fotografia analitica completa dell'account.
//
// Differente dal briefing settimanale (briefing.js):
//   - Briefing: 1 pagina, periodo breve, cron-friendly.
//   - Deep:     una-tantum, esplora tutto lo storico Turso, output lungo,
//               LLM piu' coraggioso (verita' scomode + strategia 30g).
//
// 9 sezioni: Identita / Di cosa parli / Format & Cadence / Audience /
// Performance / Top 5 / Bottom 5 / Curva follower / Verita' scomode + Strategia.
//
// Richiede OPENAI_API_KEY. Senza, esce con error (a differenza del briefing
// che ha un fallback data-only — qui il LLM fa il 70% del lavoro).
//
// Uso:
//   npm run report:deep                 → output in reports/deep-YYYY-MM-DD.md
//   npm run report:deep -- --output=stdout
//   npm run report:deep -- --no-llm     → solo data dump JSON, niente narrativa

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getDb, todayIsoDate, startRunLog, endRunLog } from "./db.js";
import { resolveMediaType } from "../src/analytics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = resolve(__dirname, "..", "..", "reports");
const SKILL_REFS_DIR = resolve(
  __dirname,
  "..",
  "..",
  ".claude",
  "skills",
  "pulp-briefing",
  "references"
);

function readSkillRef(name) {
  try {
    return readFileSync(resolve(SKILL_REFS_DIR, name), "utf8");
  } catch {
    return null;
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argOf = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const outputMode = argOf("output", "file");
const noLlm = args.includes("--no-llm");
if (!["file", "stdout"].includes(outputMode)) {
  console.error(`Output non supportato: ${outputMode}. Usa file | stdout.`);
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────
const num = (x) => (x == null ? 0 : Number(x));
const fmtN = (n) =>
  n == null || Number.isNaN(n) ? "—" : Math.round(Number(n)).toLocaleString("it-IT");
const pct = (n) =>
  n == null || Number.isNaN(n) ? "—" : Number(n).toFixed(1) + "%";
const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
const fmtDateShort = (iso) =>
  new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stddev(nums) {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const v = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return Math.sqrt(v);
}

// ─── Data loaders (Turso) ─────────────────────────────────────────────────

async function loadAll(db) {
  const [dailyRes, postRes, snapRes, audDateRes] = await Promise.all([
    db.execute(
      `SELECT date, fetched_at, followers_count, follows_count, media_count,
              reach, profile_views, website_clicks,
              accounts_engaged, total_interactions
       FROM daily_snapshot ORDER BY date ASC`
    ),
    db.execute(
      `SELECT post_id, timestamp, media_type, caption, permalink
       FROM post ORDER BY timestamp DESC`
    ),
    db.execute(
      `SELECT post_id, MAX(fetched_at) AS fetched_at,
              like_count, comments_count, reach, saved, shares, views
       FROM post_snapshot
       GROUP BY post_id`
    ),
    db.execute(`SELECT MAX(date) AS d FROM audience_snapshot`),
  ]);

  const audienceDate = audDateRes.rows[0]?.d || null;
  const audience = {};
  if (audienceDate) {
    const audRes = await db.execute({
      sql: `SELECT breakdown, key, value FROM audience_snapshot
            WHERE date = ? ORDER BY breakdown, value DESC`,
      args: [audienceDate],
    });
    for (const r of audRes.rows) {
      if (!audience[r.breakdown]) audience[r.breakdown] = [];
      audience[r.breakdown].push({ key: r.key, value: num(r.value) });
    }
  }

  // Latest snapshot per post (group by ha aggregato min su altri campi —
  // rifacciamo lookup vero su tutta la tabella per essere sicuri).
  const latestRes = await db.execute(
    `SELECT s.post_id, s.fetched_at, s.like_count, s.comments_count,
            s.reach, s.saved, s.shares, s.views
     FROM post_snapshot s
     INNER JOIN (
       SELECT post_id, MAX(fetched_at) AS mx
       FROM post_snapshot GROUP BY post_id
     ) lst ON lst.post_id = s.post_id AND lst.mx = s.fetched_at`
  );
  const latestByPost = {};
  for (const r of latestRes.rows) latestByPost[r.post_id] = r;

  const posts = postRes.rows.map((r) => {
    const s = latestByPost[r.post_id] || {};
    const reach = num(s.reach);
    const interactions =
      num(s.like_count) + num(s.comments_count) + num(s.saved) + num(s.shares);
    return {
      postId: r.post_id,
      timestamp: r.timestamp,
      mediaType: resolveMediaType(r),
      caption: r.caption || "",
      permalink: r.permalink || "",
      reach,
      like: num(s.like_count),
      comments: num(s.comments_count),
      saved: num(s.saved),
      shares: num(s.shares),
      views: num(s.views),
      interactions,
      er: reach > 0 ? (interactions / reach) * 100 : 0,
    };
  });

  return {
    daily: dailyRes.rows.map((r) => ({
      date: r.date,
      followers: num(r.followers_count),
      follows: num(r.follows_count),
      media_count: num(r.media_count),
      reach: num(r.reach),
      profile_views: num(r.profile_views),
      website_clicks: num(r.website_clicks),
      engaged: num(r.accounts_engaged),
      interactions: num(r.total_interactions),
    })),
    posts,
    audience,
    audienceDate,
  };
}

// ─── Restart detection ────────────────────────────────────────────────────
// Se l'account ha avuto un buco lungo (es. 253g per Pulp), trattiamolo come
// "ripartito": tutta l'analisi che segue lavora SOLO sui post post-ripartenza
// e i daily da quella data in poi. La vita pre-pausa è citata una volta come
// fatto storico nella sezione Identità, e poi sparisce — nessun pattern,
// nessun top/bottom, nessuna "verita scomoda" su quel periodo.
//
// Soglia: gap > max(60g, 5x mediana). 60g e' il floor sicuro per non beccare
// gap normali; 5x mediana scala col ritmo dell'account.

function detectRestart(posts) {
  if (posts.length < 3) return null;
  const sorted = [...posts].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const gapsWithIndex = [];
  for (let i = 1; i < sorted.length; i++) {
    const g =
      (new Date(sorted[i].timestamp).getTime() -
        new Date(sorted[i - 1].timestamp).getTime()) /
      86400000;
    gapsWithIndex.push({ idx: i, days: g });
  }
  const justGaps = gapsWithIndex.map((x) => x.days);
  const med = median(justGaps);
  const threshold = Math.max(60, med * 5);
  const big = gapsWithIndex
    .filter((x) => x.days >= threshold)
    .sort((a, b) => b.days - a.days)[0];
  if (!big) return null;
  const restartPost = sorted[big.idx];
  const lastPrePausePost = sorted[big.idx - 1];
  const firstEverPost = sorted[0];
  const restartDate = new Date(restartPost.timestamp);
  const today = new Date();
  return {
    restart_iso: restartPost.timestamp,
    restart_date_only: restartPost.timestamp.slice(0, 10),
    pause_days: Math.round(big.days),
    last_pre_pause_iso: lastPrePausePost.timestamp,
    first_ever_iso: firstEverPost.timestamp,
    days_since_restart: Math.floor(
      (today.getTime() - restartDate.getTime()) / 86400000
    ),
    pre_pause_post_count: big.idx, // numero di post pre-ripartenza
    post_restart_count: sorted.length - big.idx,
  };
}

// ─── Pre-compute (i numeri che il LLM userà come fatti) ──────────────────

function computeIdentity(daily, postsActive, restart, postsTotalEver) {
  const lastDaily = daily[daily.length - 1];
  const firstDailyActive = daily[0];
  return {
    followers_now: lastDaily?.followers ?? null,
    follows_now: lastDaily?.follows ?? null,
    media_count_now: lastDaily?.media_count ?? null,
    first_active_post_date: postsActive.length
      ? postsActive[postsActive.length - 1].timestamp // DESC ordering
      : null,
    last_post_date: postsActive.length ? postsActive[0].timestamp : null,
    first_daily_date: firstDailyActive?.date ?? null,
    last_daily_date: lastDaily?.date ?? null,
    daily_snapshots_active_count: daily.length,
    posts_in_current_phase: postsActive.length,
    posts_total_ever: postsTotalEver,
    restart, // null se nessun restart rilevato; altrimenti oggetto con dettagli pausa
  };
}

function computeCadence(posts) {
  if (posts.length < 2) {
    return { gap_median_days: null, gap_stddev_days: null, hour_distribution: {}, longest_pause_days: null, longest_pause_end: null };
  }
  const sorted = [...posts].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const gaps = [];
  let longestPause = 0;
  let longestPauseEnd = null;
  for (let i = 1; i < sorted.length; i++) {
    const g =
      (new Date(sorted[i].timestamp).getTime() -
        new Date(sorted[i - 1].timestamp).getTime()) /
      86400000;
    gaps.push(g);
    if (g > longestPause) {
      longestPause = g;
      longestPauseEnd = sorted[i].timestamp;
    }
  }
  const hours = {};
  const dows = {};
  for (const p of posts) {
    const d = new Date(p.timestamp);
    const h = d.getUTCHours(); // IG timestamp è UTC; per Italia +1/+2 si applica al rendering
    const dow = d.getUTCDay();
    hours[h] = (hours[h] || 0) + 1;
    dows[dow] = (dows[dow] || 0) + 1;
  }
  const recentGap = sorted.length
    ? Math.floor(
        (Date.now() - new Date(sorted[sorted.length - 1].timestamp).getTime()) /
          86400000
      )
    : null;
  return {
    gap_median_days: +median(gaps).toFixed(1),
    gap_stddev_days: +stddev(gaps).toFixed(1),
    hour_distribution: hours,
    dow_distribution: dows,
    longest_pause_days: Math.round(longestPause),
    longest_pause_end: longestPauseEnd,
    days_since_last_post: recentGap,
    posts_per_week_avg:
      gaps.length > 0 ? +(7 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)).toFixed(2) : null,
  };
}

function computePerformanceByType(posts) {
  const by = {};
  for (const p of posts) {
    if (!by[p.mediaType])
      by[p.mediaType] = {
        type: p.mediaType,
        count: 0,
        reach_sum: 0,
        inter_sum: 0,
        saved_sum: 0,
        shares_sum: 0,
      };
    const b = by[p.mediaType];
    b.count += 1;
    b.reach_sum += p.reach;
    b.inter_sum += p.interactions;
    b.saved_sum += p.saved;
    b.shares_sum += p.shares;
  }
  return Object.values(by)
    .map((b) => ({
      type: b.type,
      count: b.count,
      avg_reach: Math.round(b.reach_sum / b.count),
      avg_er: b.reach_sum > 0 ? +((b.inter_sum / b.reach_sum) * 100).toFixed(2) : 0,
      avg_save_rate:
        b.reach_sum > 0 ? +((b.saved_sum / b.reach_sum) * 100).toFixed(2) : 0,
      avg_share_rate:
        b.reach_sum > 0 ? +((b.shares_sum / b.reach_sum) * 100).toFixed(2) : 0,
    }))
    .sort((a, b) => b.avg_reach - a.avg_reach);
}

function computeFollowerTrend(daily) {
  if (!daily.length) return null;
  const first = daily[0];
  const last = daily[daily.length - 1];
  const days = daily.length;
  const delta = last.followers - first.followers;
  const dailyDeltas = [];
  for (let i = 1; i < daily.length; i++) {
    dailyDeltas.push(daily[i].followers - daily[i - 1].followers);
  }
  // Plateau: max consecutive days with |delta| <= 1
  let maxPlateau = 0;
  let cur = 0;
  for (const d of dailyDeltas) {
    if (Math.abs(d) <= 1) cur += 1;
    else cur = 0;
    if (cur > maxPlateau) maxPlateau = cur;
  }
  const last7 = daily.slice(-7);
  const last7Delta =
    last7.length >= 2 ? last7[last7.length - 1].followers - last7[0].followers : 0;
  const last30 = daily.slice(-30);
  const last30Delta =
    last30.length >= 2
      ? last30[last30.length - 1].followers - last30[0].followers
      : 0;
  return {
    start_followers: first.followers,
    end_followers: last.followers,
    span_days: days,
    delta_total: delta,
    last7_delta: last7Delta,
    last30_delta: last30Delta,
    longest_plateau_days: maxPlateau,
    avg_daily_delta: +(delta / Math.max(1, days - 1)).toFixed(2),
  };
}

function topBottomPosts(posts, n = 5) {
  const byReach = [...posts].sort((a, b) => b.reach - a.reach);
  const top = byReach.slice(0, n);
  const topIds = new Set(top.map((p) => p.postId));
  // Bottom: filtro reach >= 50 per escludere rumore, ed escludo i top per
  // evitare che un post con reach altissima ma ER basso compaia in entrambi.
  const candidates = posts.filter(
    (p) => p.reach >= 50 && !topIds.has(p.postId)
  );
  const bottom = [...candidates].sort((a, b) => a.er - b.er).slice(0, n);
  return { top, bottom };
}

function audienceSummary(audience) {
  const summarize = (rows) =>
    rows
      ? rows
          .slice(0, 10)
          .map((r) => ({ key: r.key, value: r.value, pct: null }))
      : [];
  const addPct = (rows) => {
    const sum = rows.reduce((a, r) => a + r.value, 0);
    return rows.map((r) => ({
      ...r,
      pct: sum > 0 ? +((r.value / sum) * 100).toFixed(1) : 0,
    }));
  };
  return {
    age: addPct(summarize(audience.age)),
    gender: addPct(summarize(audience.gender)),
    city: addPct(summarize(audience.city)),
    country: addPct(summarize(audience.country)),
  };
}

// ─── LLM (OpenAI) ─────────────────────────────────────────────────────────

async function callLlm(payload) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || noLlm) return null;
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";

  const brandCtx = readSkillRef("brand-context.md");
  const benchmarks = readSkillRef("benchmarks.md");

  const systemPrompt = `Sei un data analyst senior specializzato in account Instagram di micro-creator (sotto i 1.000 follower). Stai analizzando "The Pulp · Soave Sia il Vento", account community romano (NON territoriale veneto: "Soave Sia il Vento" è una citazione mozartiana — augurio letterario, non riferimento al territorio del Soave veneto). Il vino del Soave è UNO dei temi possibili (cantine, degustazione), insieme a podcast/incontri/cultura editoriale, ma il cuore è una community geo-localizzata su Roma.

=== CONTESTO BRAND (autoritativo) ===
${brandCtx || "(brand-context.md non trovato)"}

=== BENCHMARK ===
${benchmarks || "(benchmarks.md non trovato)"}

=== RUOLO ===
Il tuo lavoro NON è essere accomodante. Sei pagato per dire la verità: trovare i pattern negativi, indicare cosa non sta funzionando, suggerire scelte controintuitive se i dati le supportano. Hai diritto e dovere di essere diretto.

REGOLE:
1. **Italiano editoriale**, frasi medio-corte, trattini per ritmo, NO emoji, NO marketing-speak inglese ("engagement", "performance" usali in italiano se servono).
2. **Account piccolo & nuovo**: i benchmark IG generici (3-6% ER = good) NON si applicano. Per micro-account 0-1k follower: ER tipico 5-15%, reach naturale <100% follower, follower-growth la metrica n.1. Per il reach la cosa che conta è il **trend** non il valore assoluto.
3. **Cita sempre il post concreto** (caption reale, data) — mai "un contenuto recente". Mai inventare numeri non presenti nei dati.
4. **Verità scomode obbligatorie**: cerca attivamente almeno 4 pattern negativi. Esempi di cosa cercare: stallo follower nonostante reach buona, format trascurato (es. zero reel da X giorni), caption troppo brevi/lunghe, mono-tematicità, gap di posting recenti, mancanza di chiamate all'azione, audience che non matcha il contenuto.
5. **Topic clusters**: leggi le caption complete, raggruppa per tema reale (vino, paesaggio, persone, eventi, cucina, racconto storico, ecc). Ogni cluster: tema + post_ids che ci appartengono + take 1-2 righe sul perché funziona o no.
6. **Strategia**: 3-5 azioni con format {action, why, success_metric}. Ogni azione deve essere fattibile in 30 giorni e misurabile (es. "pubblica 4 reel sotto i 30 secondi nel mese, target ER medio > 8%" non "fai più reel").

7. **TRATTAMENTO DELLA RIPARTENZA — REGOLA CRITICA**: se nel payload identity.restart è presente (non null), significa che l'account ha avuto una pausa lunga e poi è ripartito. **Da quel momento in poi, l'account va trattato come una pagina nuova nata il giorno della ripartenza** (identity.restart.restart_iso). Tutti i post nel payload, le metriche, i top/bottom, la cadenza, la curva follower fanno già riferimento SOLO alla fase post-ripartenza — il filtro è già stato applicato lato dati, tu lavori solo sul "nuovo".

   Implicazioni:
   - L'identityNarrative deve presentare l'account come "ripartito X giorni fa", "nella sua nuova fase iniziata a [data]", "in fase di lancio". Niente discorsi su "378 giorni" o "11 aprile 2025" — quello era un'altra vita.
   - Le verità scomode NON devono mai citare la pausa, il "vuoto editoriale", il "buco di N giorni", "ritmo storico", o equivalenti. La pausa è acqua passata, non un argomento. Concentrati su ciò che sta succedendo da quando è ripartito.
   - La cadenza si valuta SOLO sui post della nuova fase. Se la nuova fase è di X giorni, calcola la frequenza vera del nuovo ritmo, non diluita dal passato.
   - Se identity.restart è null, ignora questa regola e tratta l'account come continuo nel tempo.

Ritorna SOLO JSON valido con questa forma esatta:
{
  "identityNarrative": "2-3 frasi sull'account: età, ritmo storico, fase attuale",
  "topicClusters": [
    {"theme": "string", "post_ids": ["..."], "avg_reach": int, "take": "string"}
  ],
  "cadenceTake": "2-3 frasi sul ritmo di posting, costanza, gap critici",
  "audienceTake": "2-3 frasi su chi è l'audience demo + se matcha il contenuto",
  "performanceTake": "2-3 frasi su come stanno performando i format diversi, con chiarezza su cosa funziona davvero",
  "topPattern": "Cosa accomuna i top 5 post — pattern concreto, non generico",
  "bottomPattern": "Cosa accomuna i bottom 5 — diagnosi onesta",
  "followerCurveTake": "2-3 frasi sulla curva follower: trend, plateau, accelerate",
  "uncomfortableTruths": [
    {"point": "affermazione forte e specifica", "evidence": "numero/post che la prova"}
  ],
  "strategy": [
    {"action": "azione concreta misurabile", "why": "evidenza che la motiva", "success_metric": "indicatore osservabile in 30g"}
  ]
}`;

  const userPrompt = `Ecco il dump completo dei dati. Analizza tutto e ritorna il JSON come da specifica:

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\``;

  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (j.error) throw new Error(`OpenAI: ${j.error.message}`);
  const content = j.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI: risposta vuota");
  console.log(
    `LLM (${model}): ${j.usage?.prompt_tokens}+${j.usage?.completion_tokens} tok`
  );
  return JSON.parse(content);
}

// ─── Renderer markdown ────────────────────────────────────────────────────

function renderReport({
  identity,
  cadence,
  byType,
  followerTrend,
  topBottom,
  audience,
  audienceDate,
  narrative,
  posts,
}) {
  const L = [];
  const today = todayIsoDate();
  const r = identity.restart;
  L.push(`# The Pulp · Fotografia analitica · ${fmtDate(today)}`);
  L.push("");
  if (r) {
    L.push(
      `_Account ripartito il **${fmtDate(r.restart_iso)}** dopo una pausa di ${r.pause_days} giorni. ` +
        `Questa fotografia analizza **solo** la nuova fase (${r.days_since_restart} giorni, ${identity.posts_in_current_phase} post). ` +
        `La vita pre-pausa è citata come fatto storico nella sezione Identità e basta._`
    );
  } else {
    L.push(
      `_Account snapshot al ${fmtDate(today)}. Storico Turso: ${
        identity.daily_snapshots_active_count
      } daily snapshot, ${identity.posts_in_current_phase} post indicizzati._`
    );
  }
  L.push("");
  L.push("---");
  L.push("");

  // 1. Identità
  L.push("## 1. Identità");
  L.push("");
  L.push(`- **Follower attuali**: ${fmtN(identity.followers_now)}`);
  L.push(`- **Following**: ${fmtN(identity.follows_now)}`);
  if (r) {
    L.push(
      `- **Ripartenza**: ${fmtDate(r.restart_iso)} (~${r.days_since_restart} giorni fa)`
    );
    L.push(
      `- **Post nella nuova fase**: ${identity.posts_in_current_phase}`
    );
    L.push("");
    L.push(
      `> _Storico precedente: ${r.pre_pause_post_count} post tra ${fmtDate(r.first_ever_iso)} e ${fmtDate(r.last_pre_pause_iso)}, poi pausa di ${r.pause_days} giorni. Esclusi dall'analisi che segue._`
    );
  } else {
    L.push(`- **Post indicizzati**: ${identity.posts_in_current_phase}`);
    if (identity.first_active_post_date) {
      L.push(
        `- **Primo post tracciato**: ${fmtDate(identity.first_active_post_date)}`
      );
    }
  }
  if (identity.first_daily_date) {
    L.push(
      `- **Daily snapshot disponibili**: ${fmtDate(identity.first_daily_date)} → ${fmtDate(identity.last_daily_date)}`
    );
  }
  L.push("");
  if (narrative?.identityNarrative) {
    L.push(narrative.identityNarrative);
    L.push("");
  }

  // 2. Di cosa parli
  L.push("## 2. Di cosa parli");
  L.push("");
  if (narrative?.topicClusters?.length) {
    for (const c of narrative.topicClusters) {
      L.push(
        `### ${c.theme} · ${c.post_ids?.length || 0} post · reach medio ${fmtN(c.avg_reach)}`
      );
      L.push("");
      if (c.take) L.push(c.take);
      L.push("");
      // Mostra le caption corte dei post del cluster
      if (c.post_ids?.length) {
        const refs = c.post_ids
          .slice(0, 3)
          .map((id) => posts.find((p) => p.postId === id))
          .filter(Boolean);
        for (const p of refs) {
          const cap = (p.caption || "").slice(0, 100).replace(/\n+/g, " ");
          L.push(`- *${fmtDateShort(p.timestamp)}* — ${cap}${p.caption.length > 100 ? "…" : ""}`);
        }
        L.push("");
      }
    }
  } else {
    L.push("_[LLM non disponibile — cluster tematici non generati]_");
    L.push("");
  }

  // 3. Format & Cadence
  L.push("## 3. Format & ritmo di posting");
  L.push("");
  if (cadence.gap_median_days != null) {
    L.push(
      `- **Gap mediano tra post**: ${cadence.gap_median_days}g (σ ${cadence.gap_stddev_days}g)`
    );
    L.push(`- **Frequenza media**: ${cadence.posts_per_week_avg} post/settimana`);
    L.push(
      `- **Pausa più lunga**: ${cadence.longest_pause_days}g (terminata il ${
        cadence.longest_pause_end ? fmtDate(cadence.longest_pause_end) : "—"
      })`
    );
    L.push(`- **Giorni dall'ultimo post**: ${cadence.days_since_last_post}`);
  }
  L.push("");
  L.push("**Performance per tipo di contenuto**:");
  L.push("");
  L.push("| Tipo | N | Reach medio | ER medio | Save rate | Share rate |");
  L.push("|---|---:|---:|---:|---:|---:|");
  for (const t of byType) {
    L.push(
      `| ${t.type} | ${t.count} | ${fmtN(t.avg_reach)} | ${pct(t.avg_er)} | ${pct(
        t.avg_save_rate
      )} | ${pct(t.avg_share_rate)} |`
    );
  }
  L.push("");
  if (narrative?.cadenceTake) {
    L.push(narrative.cadenceTake);
    L.push("");
  }
  if (narrative?.performanceTake) {
    L.push(narrative.performanceTake);
    L.push("");
  }

  // 4. Audience
  L.push("## 4. Audience");
  L.push("");
  if (audienceDate) {
    L.push(`_Snapshot demografico al ${fmtDate(audienceDate)}_`);
    L.push("");
    for (const [breakdown, label] of [
      ["age", "Età"],
      ["gender", "Genere"],
      ["city", "Città"],
      ["country", "Paese"],
    ]) {
      const rows = audience[breakdown] || [];
      if (!rows.length) continue;
      L.push(`**${label}**:`);
      for (const r of rows.slice(0, 6)) {
        L.push(`- ${r.key}: ${r.pct}% (${fmtN(r.value)})`);
      }
      L.push("");
    }
  } else {
    L.push("_Nessun dato audience disponibile (sotto soglia IG di 100 follower engaged?)_");
    L.push("");
  }
  if (narrative?.audienceTake) {
    L.push(narrative.audienceTake);
    L.push("");
  }

  // 5. Performance — già implicita nei numeri sopra. Skip header dedicato,
  // unifichiamo in un take di sintesi.
  // (le metriche sono distribuite nelle sezioni 3 e 4)

  // 6. Top 5
  L.push("## 5. Top 5 post per reach");
  L.push("");
  L.push("| Data | Tipo | Reach | ER | Saved | Shares | Caption |");
  L.push("|---|---|---:|---:|---:|---:|---|");
  for (const p of topBottom.top) {
    const cap = (p.caption || "").slice(0, 70).replace(/\|/g, "\\|").replace(/\n+/g, " ");
    L.push(
      `| ${fmtDateShort(p.timestamp)} | ${p.mediaType} | ${fmtN(p.reach)} | ${pct(p.er)} | ${p.saved} | ${p.shares} | ${cap}${p.caption.length > 70 ? "…" : ""} |`
    );
  }
  L.push("");
  if (narrative?.topPattern) {
    L.push(`**Pattern dei vincenti**: ${narrative.topPattern}`);
    L.push("");
  }

  // 7. Bottom 5
  L.push("## 6. Bottom 5 — sotto-performer");
  L.push("");
  if (topBottom.bottom.length) {
    L.push("_Filtrati su reach ≥ 50 per evitare rumore. Ordinati per ER ascendente._");
    L.push("");
    L.push("| Data | Tipo | Reach | ER | Saved | Shares | Caption |");
    L.push("|---|---|---:|---:|---:|---:|---|");
    for (const p of topBottom.bottom) {
      const cap = (p.caption || "").slice(0, 70).replace(/\|/g, "\\|").replace(/\n+/g, " ");
      L.push(
        `| ${fmtDateShort(p.timestamp)} | ${p.mediaType} | ${fmtN(p.reach)} | ${pct(p.er)} | ${p.saved} | ${p.shares} | ${cap}${p.caption.length > 70 ? "…" : ""} |`
      );
    }
    L.push("");
    if (narrative?.bottomPattern) {
      L.push(`**Pattern dei sotto-performer**: ${narrative.bottomPattern}`);
      L.push("");
    }
  } else {
    L.push("_Non abbastanza post sopra soglia reach 50 per estrarre 5 candidati._");
    L.push("");
  }

  // 8. Curva follower
  L.push("## 7. Curva follower");
  L.push("");
  if (followerTrend) {
    L.push(`- **Inizio storico**: ${fmtN(followerTrend.start_followers)} follower`);
    L.push(`- **Oggi**: ${fmtN(followerTrend.end_followers)} follower`);
    L.push(
      `- **Crescita totale (${followerTrend.span_days}g)**: ${followerTrend.delta_total >= 0 ? "+" : ""}${followerTrend.delta_total}`
    );
    L.push(
      `- **Ultimi 30g**: ${followerTrend.last30_delta >= 0 ? "+" : ""}${followerTrend.last30_delta} · **Ultimi 7g**: ${followerTrend.last7_delta >= 0 ? "+" : ""}${followerTrend.last7_delta}`
    );
    L.push(
      `- **Plateau più lungo** (giorni consecutivi con |Δ| ≤ 1): ${followerTrend.longest_plateau_days}g`
    );
    L.push(
      `- **Crescita media giornaliera**: ${followerTrend.avg_daily_delta} follower/giorno`
    );
  }
  L.push("");
  if (narrative?.followerCurveTake) {
    L.push(narrative.followerCurveTake);
    L.push("");
  }

  // 9. Verità scomode
  L.push("## 8. Verità scomode");
  L.push("");
  if (narrative?.uncomfortableTruths?.length) {
    for (const t of narrative.uncomfortableTruths) {
      L.push(`- **${t.point}**`);
      if (t.evidence) L.push(`  _${t.evidence}_`);
    }
    L.push("");
  } else {
    L.push("_[LLM non disponibile — sezione critica saltata]_");
    L.push("");
  }

  // 10. Strategia
  L.push("## 9. Strategia 30 giorni");
  L.push("");
  if (narrative?.strategy?.length) {
    narrative.strategy.forEach((s, i) => {
      L.push(`### ${i + 1}. ${s.action}`);
      if (s.why) L.push(`**Perché**: ${s.why}`);
      if (s.success_metric) L.push(`**Misura il successo con**: ${s.success_metric}`);
      L.push("");
    });
  } else {
    L.push("_[LLM non disponibile — strategia non generata]_");
    L.push("");
  }

  // Note
  L.push("---");
  L.push("");
  L.push("## Note di metodo");
  L.push("");
  if (r) {
    L.push(
      `- **Filtro ripartenza attivo**: tutte le metriche, tabelle e analisi narrative qui sopra fanno riferimento ai post pubblicati dal ${fmtDate(r.restart_iso)} in poi (${r.days_since_restart} giorni, ${identity.posts_in_current_phase} post). Lo storico pre-pausa (${r.pre_pause_post_count} post tra ${fmtDate(r.first_ever_iso)} e ${fmtDate(r.last_pre_pause_iso)}) è escluso dalle aggregazioni perché preceduto da una pausa di ${r.pause_days} giorni — di fatto un'altra fase del progetto.`
    );
  }
  L.push(
    `- Reach e accounts_engaged dei daily sono **somme giornaliere**, non valori unique-su-finestra (per quello servirebbe Graph API live). Per i tier IG viene usato benchmark micro-account (sotto 1k follower).`
  );
  L.push(
    `- Top/Bottom calcolati sulla **ultima snapshot disponibile** di ogni post (cron 4h); ER = (like + commenti + saved + shares) / reach × 100.`
  );
  L.push(
    `- Bottom 5 filtrati su reach ≥ 50 per evitare rumore di post quasi-mai-visti.`
  );
  L.push(
    `- Generato da \`scripts/report-deep.js\`${narrative ? ` · narrative via OpenAI ${process.env.OPENAI_MODEL || "gpt-5.4-mini"}` : " · narrative non disponibile"}.`
  );
  L.push("");

  return L.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const db = await getDb();
  const runId = await startRunLog("report-deep");

  try {
    console.log("Caricamento dati da Turso...");
    const { daily, posts, audience, audienceDate } = await loadAll(db);
    if (!daily.length || !posts.length) {
      const msg = "Storico vuoto: lancia 'npm run snapshot' qualche volta prima di generare il deep report.";
      console.error(msg);
      await endRunLog(runId, { status: "error", error: msg });
      process.exit(1);
    }

    // Restart detection: se c'e' stato un buco lungo, l'analisi che segue
    // lavora SOLO su post + daily post-ripartenza. La vita pre-pausa diventa
    // un fatto storico citato una volta nella sezione Identita, e basta.
    const restart = detectRestart(posts);
    const postsActive = restart
      ? posts.filter((p) => p.timestamp >= restart.restart_iso)
      : posts;
    const dailyActive = restart
      ? daily.filter((d) => d.date >= restart.restart_date_only)
      : daily;
    if (restart) {
      console.log(
        `Restart rilevato: pausa di ${restart.pause_days}g, ripartenza il ${restart.restart_date_only}. ` +
          `Analisi limitata ai ${postsActive.length} post post-ripartenza (esclusi ${restart.pre_pause_post_count} pre-pausa).`
      );
    }
    console.log(
      `Caricati: ${dailyActive.length} daily · ${postsActive.length} post · audience ${audienceDate || "n/a"}`
    );

    const identity = computeIdentity(dailyActive, postsActive, restart, posts.length);
    const cadence = computeCadence(postsActive);
    const byType = computePerformanceByType(postsActive);
    const followerTrend = computeFollowerTrend(dailyActive);
    const topBottom = topBottomPosts(postsActive, 5);
    const audSummary = audienceSummary(audience);

    // Payload per LLM: SOLO post post-ripartenza (se restart rilevato).
    // La pausa precedente e' un fact-only nel campo identity.restart.
    const llmPayload = {
      identity,
      cadence,
      performance_by_type: byType,
      follower_trend: followerTrend,
      audience: { date: audienceDate, ...audSummary },
      posts: postsActive.map((p) => ({
        id: p.postId,
        date: p.timestamp,
        type: p.mediaType,
        caption: (p.caption || "").slice(0, 600),
        reach: p.reach,
        er: +p.er.toFixed(2),
        like: p.like,
        comments: p.comments,
        saved: p.saved,
        shares: p.shares,
        views: p.views,
      })),
      top5: topBottom.top.map((p) => ({
        id: p.postId,
        date: p.timestamp,
        type: p.mediaType,
        reach: p.reach,
        er: +p.er.toFixed(2),
        caption_preview: (p.caption || "").slice(0, 200),
      })),
      bottom5: topBottom.bottom.map((p) => ({
        id: p.postId,
        date: p.timestamp,
        type: p.mediaType,
        reach: p.reach,
        er: +p.er.toFixed(2),
        caption_preview: (p.caption || "").slice(0, 200),
      })),
    };

    let narrative = null;
    if (!noLlm) {
      console.log("Chiamata OpenAI per narrative + verità scomode...");
      try {
        narrative = await callLlm(llmPayload);
      } catch (e) {
        console.warn(`LLM fallita: ${e.message} — proseguo data-only`);
      }
    }

    const markdown = renderReport({
      identity,
      cadence,
      byType,
      followerTrend,
      topBottom,
      audience: audSummary,
      audienceDate,
      narrative,
      posts: postsActive,
    });

    if (outputMode === "stdout") {
      process.stdout.write(markdown);
    } else {
      mkdirSync(REPORTS_DIR, { recursive: true });
      const filepath = resolve(REPORTS_DIR, `deep-${todayIsoDate()}.md`);
      writeFileSync(filepath, markdown);
      console.log(`OK report → ${filepath} (${markdown.length} chars)`);
    }

    await endRunLog(runId, {
      status: "ok",
      summary: JSON.stringify({
        posts: posts.length,
        daily: daily.length,
        narrative: !!narrative,
      }),
    });
  } catch (err) {
    console.error(`KO report-deep: ${err.message}`);
    console.error(err.stack);
    await endRunLog(runId, { status: "error", error: err.message });
    process.exit(1);
  }
}

main();
