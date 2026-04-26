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
import { getDb, todayIsoDate, startRunLog, endRunLog, getMeta } from "./db.js";
import { resolveMediaType } from "../src/analytics.js";
import {
  createGql,
  loadCredentials,
  resolveIgUserId,
  fetchProfile,
} from "./ig-fetch.js";

// Live profile fetch — IG Graph API e' la fonte di verita' per i valori
// "ora" (follower / following / media_count). Lo snapshot Turso ha quello
// catturato dal cron mattutino e puo' essere off di qualche unita'.
async function fetchLiveProfile() {
  try {
    const { token, pageId, api } = await loadCredentials();
    if (!token || !pageId) return null;
    const gql = createGql({ token, api });
    const cached = await getMeta("ig_user_id");
    const igUserId = cached || (await resolveIgUserId(gql, pageId));
    return await fetchProfile(gql, igUserId);
  } catch (e) {
    console.warn(`[live profile] skip: ${e.message}`);
    return null;
  }
}

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
  const [dailyRes, postRes, snapRes, audDateRes, storyRes] = await Promise.all([
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
    db.execute(
      `SELECT story_id, timestamp, media_type, permalink
       FROM story ORDER BY timestamp DESC`
    ),
  ]);

  // Latest snapshot per story (analoga a quella per post sotto).
  const storyLatestRes = await db.execute(
    `SELECT s.story_id, s.fetched_at, s.reach, s.replies, s.navigation,
            s.shares, s.total_interactions
     FROM story_snapshot s
     INNER JOIN (
       SELECT story_id, MAX(fetched_at) AS mx
       FROM story_snapshot GROUP BY story_id
     ) lst ON lst.story_id = s.story_id AND lst.mx = s.fetched_at`
  );
  const storyLatestById = {};
  for (const r of storyLatestRes.rows) storyLatestById[r.story_id] = r;
  const stories = storyRes.rows.map((r) => {
    const s = storyLatestById[r.story_id] || {};
    return {
      storyId: r.story_id,
      timestamp: r.timestamp,
      mediaType: r.media_type,
      permalink: r.permalink || "",
      reach: num(s.reach),
      replies: num(s.replies),
      navigation: num(s.navigation),
      shares: num(s.shares),
      total_interactions: num(s.total_interactions),
    };
  });

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
    stories,
  };
}

// Aggregati per le stories: count, reach medio, reply rate, navigation rate.
// Le stories sono un canale di nurturing dell'audience esistente — non
// strumento di crescita follower. KPI primario: reply rate (DM = high effort).
function computeStoryStats(stories) {
  if (!stories || !stories.length) return null;
  const tot = stories.reduce(
    (acc, s) => ({
      reach: acc.reach + s.reach,
      replies: acc.replies + s.replies,
      navigation: acc.navigation + s.navigation,
      shares: acc.shares + s.shares,
      interactions: acc.interactions + s.total_interactions,
    }),
    { reach: 0, replies: 0, navigation: 0, shares: 0, interactions: 0 }
  );
  // Cadenza: storie/settimana sulla finestra coperta
  const sorted = [...stories].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const spanDays =
    sorted.length > 1
      ? (new Date(sorted[sorted.length - 1].timestamp).getTime() -
          new Date(sorted[0].timestamp).getTime()) /
        86400000
      : 1;
  // Cadenza settimanale ha senso solo con span >= 3 giorni; sotto e' rumore
  // (8 stories in 1 giorno → proiezione 56/sett, fuorviante).
  const perWeek =
    spanDays >= 3 ? (sorted.length / spanDays) * 7 : null;
  // Top story per reach
  const topStory = [...stories].sort((a, b) => b.reach - a.reach)[0] || null;
  return {
    count: stories.length,
    span_days: +spanDays.toFixed(1),
    stories_per_week_avg: perWeek != null ? +perWeek.toFixed(2) : null,
    reach_total: tot.reach,
    reach_avg: stories.length ? Math.round(tot.reach / stories.length) : 0,
    replies_total: tot.replies,
    reply_rate_pct:
      tot.reach > 0 ? +((tot.replies / tot.reach) * 100).toFixed(2) : 0,
    navigation_per_reach:
      tot.reach > 0 ? +(tot.navigation / tot.reach).toFixed(2) : 0,
    shares_total: tot.shares,
    interactions_rate_pct:
      tot.reach > 0 ? +((tot.interactions / tot.reach) * 100).toFixed(2) : 0,
    top_story: topStory
      ? {
          id: topStory.storyId,
          timestamp: topStory.timestamp,
          media_type: topStory.mediaType,
          reach: topStory.reach,
          replies: topStory.replies,
          navigation: topStory.navigation,
        }
      : null,
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

function computeIdentity(daily, postsActive, restart, postsTotalEver, liveProfile) {
  const lastDaily = daily[daily.length - 1];
  const firstDailyActive = daily[0];
  // Live wins: il numero "ora" viene da Graph API; lo snapshot Turso e' del
  // cron mattutino e puo' essere off di qualche unita' (es. snapshot 475,
  // live 476 = +1 nel pomeriggio non ancora catturato).
  const followersNow = liveProfile?.followers_count ?? lastDaily?.followers ?? null;
  const followsNow = liveProfile?.follows_count ?? lastDaily?.follows ?? null;
  const mediaCountNow = liveProfile?.media_count ?? lastDaily?.media_count ?? null;
  const followersDriftFromSnapshot =
    liveProfile?.followers_count != null && lastDaily?.followers != null
      ? liveProfile.followers_count - lastDaily.followers
      : 0;
  return {
    followers_now: followersNow,
    follows_now: followsNow,
    media_count_now: mediaCountNow,
    followers_snapshot_value: lastDaily?.followers ?? null,
    followers_drift_from_snapshot: followersDriftFromSnapshot,
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

// ─── Pre-compute esteso ───────────────────────────────────────────────────

function computeCaptionForensics(posts) {
  const CTA_WORDS = [
    "scrivi", "racconta", "rispondi", "dimmi", "commenta", "tagga",
    "salva", "condividi", "fammi sapere",
  ];
  const hasCta = (cap) => {
    const lower = cap.toLowerCase();
    if (CTA_WORDS.some((w) => lower.includes(w))) return true;
    // ?! consecutivi (qualsiasi ordine)
    if (/[?!][!?]/.test(cap)) return true;
    return false;
  };

  const total = posts.length;
  let count_empty = 0;
  let count_short = 0;
  let count_with_question = 0;
  let count_with_cta = 0;
  let count_with_mention = 0;
  let count_with_hashtag = 0;
  const lengths = [];
  const hashtagCounts = {};
  const mentionCounts = {};

  for (const p of posts) {
    const cap = p.caption || "";
    const trimmed = cap.trim();

    if (!trimmed) {
      count_empty += 1;
      continue; // vuota — non conta per avg_length, short, ecc.
    }

    const len = trimmed.length;
    lengths.push(len);

    if (len < 30) count_short += 1;
    if (cap.includes("?")) count_with_question += 1;
    if (hasCta(cap)) count_with_cta += 1;
    if (/@\w/.test(cap)) count_with_mention += 1;
    if (/#\w/.test(cap)) count_with_hashtag += 1;

    // Estrai hashtag
    const tags = cap.match(/#[\wÀ-ɏ]+/gi) || [];
    for (const t of tags) {
      const k = t.toLowerCase();
      hashtagCounts[k] = (hashtagCounts[k] || 0) + 1;
    }
    // Estrai menzioni
    const mentions = cap.match(/@[\w.]+/gi) || [];
    for (const m of mentions) {
      const k = m.toLowerCase();
      mentionCounts[k] = (mentionCounts[k] || 0) + 1;
    }
  }

  const avg_length = lengths.length
    ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length)
    : 0;
  const med_length = Math.round(median(lengths));

  const hashtag_top10 = Object.entries(hashtagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  const mention_top10 = Object.entries(mentionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([handle, count]) => ({ handle, count }));

  return {
    count_total: total,
    count_empty,
    count_short,
    count_with_question,
    count_with_cta,
    count_with_mention,
    count_with_hashtag,
    avg_length,
    median_length: med_length,
    hashtag_top10,
    mention_top10,
    cta_rate_pct: total > 0 ? +((count_with_cta / total) * 100).toFixed(2) : 0,
    question_rate_pct: total > 0 ? +((count_with_question / total) * 100).toFixed(2) : 0,
  };
}

function computeHourDowMatrix(posts) {
  const DOW_LABELS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
  // 0=Dom, 1=Lun…6=Sab in getUTCDay(); mappiamo a Lun=0..Dom=6
  const toLocalDow = (utcDay) => (utcDay === 0 ? 6 : utcDay - 1);
  const SLOTS = ["00-04", "04-08", "08-12", "12-16", "16-20", "20-24"];
  const toSlotIdx = (h) => Math.min(Math.floor(h / 4), 5);

  // Inizializza matrice 7×6
  const cells = Array.from({ length: 7 }, () =>
    Array.from({ length: 6 }, () => ({ count: 0, reach_sum: 0 }))
  );

  for (const p of posts) {
    const d = new Date(p.timestamp);
    const dow = toLocalDow(d.getUTCDay());
    const slot = toSlotIdx(d.getUTCHours());
    cells[dow][slot].count += 1;
    cells[dow][slot].reach_sum += p.reach;
  }

  const matrix = DOW_LABELS.map((dow, di) => ({
    dow,
    buckets: SLOTS.map((slot, si) => {
      const c = cells[di][si];
      return {
        slot,
        count: c.count,
        avg_reach: c.count > 0 ? Math.round(c.reach_sum / c.count) : 0,
      };
    }),
  }));

  // Flat list di celle con count >= 1 per best/worst
  const activeCells = [];
  for (let di = 0; di < 7; di++) {
    for (let si = 0; si < 6; si++) {
      const c = cells[di][si];
      if (c.count >= 1) {
        activeCells.push({
          dow: DOW_LABELS[di],
          slot: SLOTS[si],
          count: c.count,
          avg_reach: Math.round(c.reach_sum / c.count),
        });
      }
    }
  }

  const best_slot = activeCells.length
    ? activeCells.reduce((a, b) => (b.avg_reach > a.avg_reach ? b : a))
    : null;
  const worst_slot = activeCells.length
    ? activeCells.reduce((a, b) => (b.avg_reach < a.avg_reach ? b : a))
    : null;
  const most_used_slot = activeCells.length
    ? activeCells.reduce((a, b) => (b.count > a.count ? b : a))
    : null;

  const unused_slots_count = 7 * 6 - activeCells.length;

  return { matrix, best_slot, worst_slot, most_used_slot, unused_slots_count };
}

function computeCohortComparison(posts, windowSize = 5) {
  if (posts.length < 2 * windowSize) return null;

  const sorted = [...posts].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const avg = (arr, key) =>
    arr.length ? arr.reduce((s, p) => s + (p[key] || 0), 0) / arr.length : 0;

  const early = sorted.slice(0, windowSize);
  const late = sorted.slice(-windowSize);

  const earlyReach = avg(early, "reach");
  const lateReach = avg(late, "reach");
  const reach_delta_pct =
    earlyReach > 0 ? +((lateReach - earlyReach) / earlyReach * 100).toFixed(2) : 0;

  const earlyEr = avg(early, "er");
  const lateEr = avg(late, "er");
  const er_delta_pct =
    earlyEr > 0 ? +((lateEr - earlyEr) / earlyEr * 100).toFixed(2) : 0;

  const trend =
    reach_delta_pct > 10 ? "improving" : reach_delta_pct < -10 ? "degrading" : "stalling";

  const periodLabel = (group) => {
    const first = group[0].timestamp.slice(0, 10);
    const last = group[group.length - 1].timestamp.slice(0, 10);
    return first === last ? first : `${first} → ${last}`;
  };

  return {
    early: {
      count: early.length,
      avg_reach: +earlyReach.toFixed(1),
      avg_er: +earlyEr.toFixed(2),
      avg_saved: +avg(early, "saved").toFixed(2),
      avg_shares: +avg(early, "shares").toFixed(2),
      period_label: periodLabel(early),
    },
    late: {
      count: late.length,
      avg_reach: +lateReach.toFixed(1),
      avg_er: +lateEr.toFixed(2),
      avg_saved: +avg(late, "saved").toFixed(2),
      avg_shares: +avg(late, "shares").toFixed(2),
      period_label: periodLabel(late),
    },
    reach_delta_pct,
    er_delta_pct,
    trend,
  };
}

function computeWeightedEngagement(posts) {
  const score = (p) => p.shares * 4 + p.saved * 3 + p.comments * 2 + p.like * 1;

  const enriched = posts.map((p) => {
    const ws = score(p);
    return {
      ...p,
      weighted_score: ws,
      weighted_score_per_reach: p.reach > 0 ? +((ws / p.reach) * 100).toFixed(4) : 0,
    };
  });

  const sortedByWs = [...enriched].sort((a, b) => b.weighted_score - a.weighted_score);

  const fmt = (p) => ({
    post_id: p.postId,
    timestamp: p.timestamp,
    media_type: p.mediaType,
    caption_preview: (p.caption || "").slice(0, 160),
    weighted_score: p.weighted_score,
    weighted_score_per_reach: p.weighted_score_per_reach,
    reach: p.reach,
  });

  const top5_by_weighted = sortedByWs.slice(0, 5).map(fmt);

  // Bottom 5: solo post con reach >= 50
  const candidates = enriched.filter((p) => p.reach >= 50);
  const bottom5_by_weighted = [...candidates]
    .sort((a, b) => a.weighted_score - b.weighted_score)
    .slice(0, 5)
    .map(fmt);

  const wsPerReachValues = enriched
    .filter((p) => p.reach > 0)
    .map((p) => p.weighted_score_per_reach);

  const avg_weighted_per_reach = wsPerReachValues.length
    ? +(wsPerReachValues.reduce((a, b) => a + b, 0) / wsPerReachValues.length).toFixed(4)
    : 0;
  const median_weighted_per_reach = +median(wsPerReachValues).toFixed(4);

  return {
    top5_by_weighted,
    bottom5_by_weighted,
    avg_weighted_per_reach,
    median_weighted_per_reach,
  };
}

function computeContentDebt(posts) {
  const total = posts.length;
  if (!total) {
    return {
      empty_caption_pct: 0,
      short_caption_pct: 0,
      no_cta_pct: 0,
      no_mention_no_collab_pct: 0,
      format_concentration: { top_type: null, top_type_pct: 0 },
      longest_dry_streak_days: 0,
    };
  }

  const CTA_WORDS = [
    "scrivi", "racconta", "rispondi", "dimmi", "commenta", "tagga",
    "salva", "condividi", "fammi sapere",
  ];
  const hasCta = (cap) => {
    const lower = cap.toLowerCase();
    if (CTA_WORDS.some((w) => lower.includes(w))) return true;
    if (/[?!][!?]/.test(cap)) return true;
    return false;
  };

  let empty = 0;
  let short = 0;
  let no_cta = 0;
  let no_mention = 0;
  const typeCounts = {};

  for (const p of posts) {
    const cap = (p.caption || "").trim();
    if (!cap) empty += 1;
    else if (cap.length < 30) short += 1;
    if (!hasCta(p.caption || "")) no_cta += 1;
    if (!/@\w/.test(p.caption || "")) no_mention += 1;
    typeCounts[p.mediaType] = (typeCounts[p.mediaType] || 0) + 1;
  }

  // Format concentration
  const topEntry = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
  const top_type = topEntry ? topEntry[0] : null;
  const top_type_pct = topEntry ? +((topEntry[1] / total) * 100).toFixed(1) : 0;

  // Longest dry streak: giorni dall'ultimo post (cioè la pausa più recente)
  const sorted = [...posts].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  const longest_dry_streak_days = sorted.length
    ? Math.floor((Date.now() - new Date(sorted[0].timestamp).getTime()) / 86400000)
    : 0;

  return {
    empty_caption_pct: +((empty / total) * 100).toFixed(2),
    short_caption_pct: +((short / total) * 100).toFixed(2),
    no_cta_pct: +((no_cta / total) * 100).toFixed(2),
    no_mention_no_collab_pct: +((no_mention / total) * 100).toFixed(2),
    format_concentration: { top_type, top_type_pct },
    longest_dry_streak_days,
  };
}

function computePulpIndex(identity, cadence, byType, followerTrend, contentDebt, captionForensics) {
  // --- Cadenza score (0-25) ---
  const ppw = cadence.posts_per_week_avg ?? 0;
  let cadenceScore;
  if (ppw >= 3.5) {
    cadenceScore = 25;
  } else if (ppw <= 0.5) {
    cadenceScore = 0;
  } else {
    // lineare da 0.5→0 a 3.5→25
    cadenceScore = Math.round(((ppw - 0.5) / (3.5 - 0.5)) * 25);
  }

  // --- Variety score (0-15) ---
  const uniqueTypes = new Set((byType || []).map((t) => t.type)).size;
  const varietyScore = uniqueTypes >= 3 ? 15 : uniqueTypes === 2 ? 10 : 5;

  // --- Engagement score (0-25) ---
  // basato su ER medio dei top 5 type (già ordinati per avg_reach desc)
  const topTypes = (byType || []).slice(0, 5);
  const avgEr = topTypes.length
    ? topTypes.reduce((s, t) => s + t.avg_er, 0) / topTypes.length
    : 0;
  let engagementScore;
  if (avgEr >= 6) engagementScore = 25;
  else if (avgEr >= 3) engagementScore = 18;
  else if (avgEr >= 1) engagementScore = 10;
  else engagementScore = 0;

  // --- Growth score (0-20) ---
  const last7 = followerTrend?.last7_delta ?? 0;
  let growthScore;
  if (last7 >= 5) growthScore = 20;
  else if (last7 >= 1) growthScore = 12;
  else if (last7 === 0) growthScore = 5;
  else growthScore = 0;

  // --- Caption depth score (0-15) ---
  const ctaRate = captionForensics?.cta_rate_pct ?? 0;
  const emptyPct = contentDebt?.empty_caption_pct ?? 0;
  let captionScore;
  if (ctaRate >= 40 && emptyPct < 5) {
    captionScore = 15;
  } else if (ctaRate >= 25 && emptyPct < 15) {
    captionScore = 10;
  } else if (ctaRate >= 10 && emptyPct < 30) {
    captionScore = 5;
  } else {
    captionScore = 0;
  }

  const total = cadenceScore + varietyScore + engagementScore + growthScore + captionScore;

  let grade;
  if (total >= 90) grade = "A+";
  else if (total >= 80) grade = "A";
  else if (total >= 70) grade = "B+";
  else if (total >= 60) grade = "B";
  else if (total >= 50) grade = "C+";
  else if (total >= 40) grade = "C";
  else if (total >= 30) grade = "D";
  else grade = "F";

  return {
    total,
    cadence: cadenceScore,
    variety: varietyScore,
    engagement: engagementScore,
    growth: growthScore,
    caption_depth: captionScore,
    grade,
  };
}

// ─── LLM (OpenAI) ─────────────────────────────────────────────────────────

async function callLlm(payload) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || noLlm) return null;
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";

  const brandCtx = readSkillRef("brand-context.md");
  const benchmarks = readSkillRef("benchmarks.md");

  const systemPrompt = `Sei un consulente strategy senior per micro-account Instagram (0-1k follower). Hai 15 anni di esperienza, hai lavorato con community editoriali, podcast, brand culturali. Sei pagato per dire la verità che i fondatori non vogliono sentire — non per essere accomodante o produrre liste di "ottimi spunti". Stai analizzando "The Pulp · Soave Sia il Vento", account community romano. ATTENZIONE: "Soave Sia il Vento" è una citazione da "Così fan tutte" di Mozart (augurio letterario), NON un riferimento al territorio veneto del vino Soave. Il vino può essere UN tema ma non è il cuore: il cuore è una community geo-locale romana di taglio editoriale-letterario.

=== CONTESTO BRAND (autoritativo) ===
${brandCtx || "(brand-context.md non trovato)"}

=== BENCHMARK ===
${benchmarks || "(benchmarks.md non trovato)"}

=== TU SEI ===
Pensa come una crasi tra: un consulente McKinsey (struttura), un editor culturale (sensibilità per il contenuto), un growth hacker pragmatico (sa cosa muove i numeri), un terapista (dice le cose che fanno male in modo che si possano accettare). NON sei un copywriter. NON sei un cheerleader. NON produci "spunti interessanti" — produci diagnosi e azioni testabili.

PROCESSO MENTALE (segui questo flow prima di scrivere):
1. Leggi il PULP INDEX (payload.pulp_index): è il punteggio di salute 0-100 con 5 sub-score (cadence, variety, engagement, growth, caption_depth) + grade A+ → F. Quale sub-score è il più basso? Quello è il punto di leva primario.
2. Leggi CONTENT DEBT (payload.content_debt): % caption vuote/corte, % senza CTA, % senza mention, format_concentration. Sono i "debiti tecnici" del content.
3. Leggi CAPTION FORENSICS (payload.caption_forensics): cta_rate_pct, question_rate_pct, hashtag_top10, mention_top10, lunghezza media. Cosa scrivono davvero?
4. Leggi HOUR_DOW_MATRIX (payload.hour_dow_matrix): best_slot, worst_slot, most_used_slot. C'è un mismatch tra quando pubblicano e quando funziona meglio?
5. Leggi COHORT (payload.cohort): early vs late. Trend "improving"/"stalling"/"degrading"? Questa è la diagnosi più importante della SALUTE.
6. Leggi WEIGHTED_ENGAGEMENT (payload.weighted_engagement): top5/bottom5 per shares×4+saves×3+comments×2+likes×1. I "veri" vincitori (qualità del segnale, non quantità di click facili).
7. Solo a questo punto formula executiveSummary, whatWorks/whatDoesnt/whatToTest, hypothesisTests, abTests, strategy.

REGOLE DI SCRITTURA:
1. **Italiano editoriale**, frasi medio-corte, trattini per ritmo, NO emoji, NO marketing-speak inglese.
2. **Account piccolo & nuovo**: i tier IG generici NON si applicano. Per 0-1k follower: ER 5-15% normale, reach naturale <100% follower, **follower-growth è la metrica n.1**, costanza > picchi. Anche il REACH conta meno del trend.
3. **Cita sempre post concreto** (caption reale, data, post_id) — mai "un contenuto recente". MAI inventare numeri non nel payload.
4. **No genericità**. Frasi come "è importante essere costanti" o "il pubblico ama l'autenticità" sono spazzatura. Ogni frase deve essere SUPPORTATA da un dato del payload e ATTACCABILE.
5. **Cita il post_id quando lo metti come prova** (sono lunghi ma necessari per audit del consiglio).
6. **Cohort è il segnale primario di salute**: se "improving", celebra ma cerca cosa sta funzionando per replicarlo. Se "stalling/degrading", quello DEVE essere l'executiveSummary.
7. **Topic clusters**: usa le caption complete in payload.posts.caption (fino a 600 char). Raggruppa per tema reale (manifesto/identità, eventi-pulp, civica/ambiente, racconto romano, dietro-le-quinte, citazione-letteraria, ecc). Per ogni cluster: tema + post_ids + share % del totale + take 2 righe.
8. **Saturazione tematica**: se un cluster supera il 35% dei post, è un alert (mono-tematicità) → finire in whatDoesnt o uncomfortableTruths.
9. **A/B test**: format ipotesi-variante-controllo-KPI-sample. Devono essere REALMENTE eseguibili in 30g (es. "alterna 4 caption-lunga vs 4 caption-corta sui prossimi 8 post di tipo immagine, KPI=ER medio, sample=4+4").
10. **Strategy ≠ azioni vaghe**. Ogni azione deve avere una metrica osservabile entro 30g e una soglia esplicita di successo/fallimento.

REGOLA CRITICA RIPARTENZA: se identity.restart è non-null, l'account è "ripartito" il giorno restart_iso. NON menzionare la pausa pre-restart, NON menzionare "vuoto editoriale" o "buco di N giorni" nelle uncomfortableTruths o nel testo. L'account è una pagina nuova partita N giorni fa. La cadence/cohort/tutto è già filtrato.

REGOLA CRITICA STORIES: stories è canale di NURTURING, non di growth. KPI primario = reply_rate. Per micro-account, REGOLARITÀ > volume di reach. Se stories.count == 0 → opportunità mancata da finire in whatDoesnt + uncomfortableTruths + strategy.

Ritorna SOLO JSON valido con questa forma esatta:
{
  "executiveSummary": "30 secondi al CEO. 2-3 frasi tese, una tesi forte. Inizia dal Pulp Index e dal sub-score più basso. Es: 'Pulp Index 58/100 = C+. Il problema non è il contenuto, è che x.'",
  "identityNarrative": "1-2 frasi sull'account: età, fase, ritmo attuale post-ripartenza se rilevante",
  "topicClusters": [
    {"theme": "string", "post_ids": ["..."], "share_pct": float, "avg_reach": int, "take": "string"}
  ],
  "captionForensicsTake": "2-3 frasi su come scrivono davvero: lunghezza, CTA, hashtag, mention. Cosa cambierebbe se scrivessero diverso?",
  "cadenceTake": "2-3 frasi sul ritmo + heatmap take: best slot, worst slot, mismatch tra quando posti e quando funziona",
  "performanceTake": "2-3 frasi sui formati: cosa scala, cosa no, e perché",
  "audienceTake": "2-3 frasi su demo + match contenuto/audience",
  "storiesTake": "2-3 frasi sul canale stories. null se stories.count == 0",
  "cohortTake": "2-3 frasi su early vs late: trend, su cosa basano la diagnosi 'improving/stalling/degrading'",
  "topPattern": "Cosa accomuna i top 5 weighted (qualità segnale alta) — pattern concreto",
  "bottomPattern": "Cosa accomuna i bottom 5 weighted — diagnosi onesta",
  "followerCurveTake": "2-3 frasi su curva follower",
  "whatWorks": [
    {"point": "cosa sta funzionando (azione/format/tema)", "evidence": "dato/post che lo prova"}
  ],
  "whatDoesnt": [
    {"point": "cosa NON sta funzionando", "evidence": "dato/post che lo prova"}
  ],
  "whatToTest": [
    {"point": "cosa testare nei prossimi 30g (cosa diversa da what works/doesn't, è una scommessa)", "rationale": "perché vale la pena testarlo"}
  ],
  "uncomfortableTruths": [
    {"point": "verità scomoda specifica e attaccabile", "evidence": "dato/post che la prova"}
  ],
  "hypothesisTests": [
    {"hypothesis": "ipotesi specifica e cadibile", "verification": "calcolo/confronto fatto sul payload", "verdict": "CONFERMATA | RESPINTA | DATI INSUFFICIENTI", "implication": "cosa ne consegue"}
  ],
  "abTests": [
    {"name": "nome breve", "hypothesis": "se faccio X, succede Y", "variant": "trattamento (cosa cambia)", "control": "baseline (cosa NON cambia)", "primary_kpi": "metrica (es. ER medio, save_rate, follower delta)", "sample": "quanti post/stories servono per ogni gruppo (min 3 per gruppo)", "duration_days": int}
  ],
  "strategy": [
    {"action": "azione concreta misurabile", "why": "evidenza", "success_metric": "soglia osservabile in 30g (es. 'ER medio > 6% sui prossimi 8 post' non 'ER migliore')"}
  ]
}

REGOLE DI QUANTITÀ:
- whatWorks: 2-4 punti
- whatDoesnt: 3-5 punti
- whatToTest: 2-4 punti
- uncomfortableTruths: 4-5 punti
- hypothesisTests: 3-5 ipotesi
- abTests: 2-3 esperimenti REALMENTE eseguibili
- strategy: 3-5 azioni
- topicClusters: 4-6 cluster (no più, no meno)`;

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
  storyStats,
  narrative,
  posts,
  captionForensics,
  hourDowMatrix,
  cohortComparison,
  weightedEngagement,
  contentDebt,
  pulpIndex,
}) {
  const L = [];
  const today = todayIsoDate();
  const r = identity.restart;

  // ─── HEADER ─────────────────────────────────────────────────────────────
  L.push(`# The Pulp · Fotografia analitica · ${fmtDate(today)}`);
  L.push("");
  if (r) {
    L.push(
      `_Account ripartito il **${fmtDate(r.restart_iso)}** dopo una pausa di ${r.pause_days} giorni. ` +
        `Questa fotografia analizza **solo** la nuova fase (${r.days_since_restart} giorni, ${identity.posts_in_current_phase} post). La vita pre-pausa è citata una volta come fatto storico, poi sparisce._`
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

  // ─── 0. EXECUTIVE COCKPIT ──────────────────────────────────────────────
  L.push("## Executive cockpit");
  L.push("");
  if (pulpIndex) {
    L.push(`### Pulp Index: **${pulpIndex.total}/100 · grade ${pulpIndex.grade}**`);
    L.push("");
    L.push("| Dimensione | Score | Max | Note |");
    L.push("|---|---:|---:|---|");
    L.push(`| Cadenza editoriale | ${pulpIndex.cadence} | 25 | ${cadence.posts_per_week_avg ?? "—"} post/sett |`);
    L.push(`| Varietà format | ${pulpIndex.variety} | 15 | ${byType.length} tipi usati |`);
    L.push(`| Engagement | ${pulpIndex.engagement} | 25 | ER ponderato per format |`);
    L.push(`| Growth follower | ${pulpIndex.growth} | 20 | ${followerTrend?.last7_delta >= 0 ? "+" : ""}${followerTrend?.last7_delta ?? 0} ultimi 7g |`);
    L.push(`| Profondità caption | ${pulpIndex.caption_depth} | 15 | ${pct(captionForensics?.cta_rate_pct)} con CTA |`);
    L.push("");
  }
  if (narrative?.executiveSummary) {
    L.push(`> ${narrative.executiveSummary}`);
    L.push("");
  }

  // ─── 1. COSA FUNZIONA / COSA NO / DA TESTARE ──────────────────────────
  if (
    narrative?.whatWorks?.length ||
    narrative?.whatDoesnt?.length ||
    narrative?.whatToTest?.length
  ) {
    L.push("## 1. Cosa funziona / Cosa no / Da testare");
    L.push("");
    if (narrative.whatWorks?.length) {
      L.push("### Cosa funziona");
      for (const w of narrative.whatWorks) {
        L.push(`- **${w.point}**`);
        if (w.evidence) L.push(`  _${w.evidence}_`);
      }
      L.push("");
    }
    if (narrative.whatDoesnt?.length) {
      L.push("### Cosa NON funziona");
      for (const w of narrative.whatDoesnt) {
        L.push(`- **${w.point}**`);
        if (w.evidence) L.push(`  _${w.evidence}_`);
      }
      L.push("");
    }
    if (narrative.whatToTest?.length) {
      L.push("### Da testare");
      for (const w of narrative.whatToTest) {
        L.push(`- **${w.point}**`);
        if (w.rationale) L.push(`  _${w.rationale}_`);
      }
      L.push("");
    }
  }

  // ─── 2. IDENTITÀ (compressa) ──────────────────────────────────────────
  L.push("## 2. Identità");
  L.push("");
  if (identity.followers_drift_from_snapshot && identity.followers_drift_from_snapshot !== 0) {
    L.push(
      `- **Follower attuali**: ${fmtN(identity.followers_now)} _(live Graph API; snapshot Turso ultimo: ${fmtN(identity.followers_snapshot_value)}, ${identity.followers_drift_from_snapshot >= 0 ? "+" : ""}${identity.followers_drift_from_snapshot} non ancora catturati)_`
    );
  } else {
    L.push(`- **Follower attuali**: ${fmtN(identity.followers_now)}`);
  }
  L.push(`- **Following**: ${fmtN(identity.follows_now)}`);
  if (r) {
    L.push(
      `- **Ripartenza**: ${fmtDate(r.restart_iso)} (~${r.days_since_restart} giorni fa) · **Post nella nuova fase**: ${identity.posts_in_current_phase}`
    );
    L.push("");
    L.push(
      `> _Storico precedente: ${r.pre_pause_post_count} post tra ${fmtDate(r.first_ever_iso)} e ${fmtDate(r.last_pre_pause_iso)}, poi pausa di ${r.pause_days} giorni. Esclusi dall'analisi che segue._`
    );
  } else {
    L.push(`- **Post indicizzati**: ${identity.posts_in_current_phase}`);
  }
  if (identity.first_daily_date) {
    L.push(
      `- **Daily snapshot Turso**: ${fmtDate(identity.first_daily_date)} → ${fmtDate(identity.last_daily_date)}`
    );
  }
  L.push("");
  if (narrative?.identityNarrative) {
    L.push(narrative.identityNarrative);
    L.push("");
  }

  // ─── 3. DI COSA PARLI (cluster tematici) ─────────────────────────────
  L.push("## 3. Di cosa parli");
  L.push("");
  if (narrative?.topicClusters?.length) {
    for (const c of narrative.topicClusters) {
      const sharePct = c.share_pct != null ? ` · ${c.share_pct.toFixed(0)}% del feed` : "";
      L.push(
        `### ${c.theme} · ${c.post_ids?.length || 0} post${sharePct} · reach medio ${fmtN(c.avg_reach)}`
      );
      L.push("");
      if (c.take) L.push(c.take);
      L.push("");
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

  // ─── 4. CAPTION FORENSICS ────────────────────────────────────────────
  if (captionForensics) {
    L.push("## 4. Caption forensics");
    L.push("");
    L.push("| Metrica | Valore |");
    L.push("|---|---:|");
    L.push(`| Caption analizzate | ${captionForensics.count_total} |`);
    L.push(`| Lunghezza media | ${captionForensics.avg_length} char |`);
    L.push(`| Lunghezza mediana | ${captionForensics.median_length} char |`);
    L.push(`| Caption vuote | ${captionForensics.count_empty} (${pct(100 * captionForensics.count_empty / Math.max(1, captionForensics.count_total))}) |`);
    L.push(`| Caption corte (<30 char) | ${captionForensics.count_short} |`);
    L.push(`| Con domanda (?) | ${captionForensics.count_with_question} (${pct(captionForensics.question_rate_pct)}) |`);
    L.push(`| Con CTA esplicita | ${captionForensics.count_with_cta} (${pct(captionForensics.cta_rate_pct)}) |`);
    L.push(`| Con menzione (@) | ${captionForensics.count_with_mention} |`);
    L.push(`| Con hashtag (#) | ${captionForensics.count_with_hashtag} |`);
    L.push("");
    if (captionForensics.hashtag_top10?.length) {
      L.push(`**Top hashtag**: ${captionForensics.hashtag_top10.slice(0, 8).map((h) => `\`${h.tag}\` ×${h.count}`).join(" · ")}`);
      L.push("");
    }
    if (captionForensics.mention_top10?.length) {
      L.push(`**Top menzioni**: ${captionForensics.mention_top10.slice(0, 8).map((m) => `\`${m.handle}\` ×${m.count}`).join(" · ")}`);
      L.push("");
    }
    if (narrative?.captionForensicsTake) {
      L.push(narrative.captionForensicsTake);
      L.push("");
    }
  }

  // ─── 5. FORMAT & CADENCE + HEATMAP ────────────────────────────────────
  L.push("## 5. Format, ritmo & quando posti");
  L.push("");
  if (cadence.gap_median_days != null) {
    L.push(
      `- **Gap mediano tra post**: ${cadence.gap_median_days}g (σ ${cadence.gap_stddev_days}g) · **Frequenza**: ${cadence.posts_per_week_avg} post/sett`
    );
    L.push(
      `- **Pausa più lunga (in fase)**: ${cadence.longest_pause_days}g · **Giorni dall'ultimo post**: ${cadence.days_since_last_post}`
    );
  }
  if (contentDebt) {
    L.push(
      `- **Debito**: ${pct(contentDebt.empty_caption_pct)} caption vuote · ${pct(contentDebt.short_caption_pct)} corte · ${pct(contentDebt.no_cta_pct)} senza CTA · concentrazione su **${contentDebt.format_concentration?.top_type}** ${pct(contentDebt.format_concentration?.top_type_pct)}`
    );
  }
  L.push("");
  L.push("**Performance per tipo di contenuto**:");
  L.push("");
  L.push("| Tipo | N | Reach medio | ER medio | Save rate | Share rate |");
  L.push("|---|---:|---:|---:|---:|---:|");
  for (const t of byType) {
    L.push(
      `| ${t.type} | ${t.count} | ${fmtN(t.avg_reach)} | ${pct(t.avg_er)} | ${pct(t.avg_save_rate)} | ${pct(t.avg_share_rate)} |`
    );
  }
  L.push("");
  if (hourDowMatrix?.matrix?.length) {
    L.push("**Heatmap giorno × fascia oraria** (reach medio per slot, vuoto = nessun post)");
    L.push("");
    const buckets = hourDowMatrix.matrix[0]?.buckets?.map((b) => b.slot) || [];
    L.push(`| | ${buckets.join(" | ")} |`);
    L.push(`|---|${buckets.map(() => "---:").join("|")}|`);
    for (const row of hourDowMatrix.matrix) {
      const cells = row.buckets.map((b) =>
        b.count === 0 ? "·" : `${fmtN(b.avg_reach)}<br><sub>${b.count}p</sub>`
      );
      L.push(`| **${row.dow}** | ${cells.join(" | ")} |`);
    }
    L.push("");
    if (hourDowMatrix.best_slot) {
      L.push(
        `- **Slot migliore**: ${hourDowMatrix.best_slot.dow} ${hourDowMatrix.best_slot.slot} → reach medio ${fmtN(hourDowMatrix.best_slot.avg_reach)} (${hourDowMatrix.best_slot.count} post)`
      );
    }
    if (hourDowMatrix.worst_slot) {
      L.push(
        `- **Slot peggiore**: ${hourDowMatrix.worst_slot.dow} ${hourDowMatrix.worst_slot.slot} → reach medio ${fmtN(hourDowMatrix.worst_slot.avg_reach)} (${hourDowMatrix.worst_slot.count} post)`
      );
    }
    if (hourDowMatrix.most_used_slot) {
      L.push(
        `- **Slot più usato**: ${hourDowMatrix.most_used_slot.dow} ${hourDowMatrix.most_used_slot.slot} → ${hourDowMatrix.most_used_slot.count} post pubblicati`
      );
    }
    L.push("");
    L.push("_Orari in UTC. Per Europa/Roma sommare +1h (inverno) o +2h (estate)._");
    L.push("");
  }
  if (narrative?.cadenceTake) {
    L.push(narrative.cadenceTake);
    L.push("");
  }
  if (narrative?.performanceTake) {
    L.push(narrative.performanceTake);
    L.push("");
  }

  // ─── 6. AUDIENCE ──────────────────────────────────────────────────────
  L.push("## 6. Audience");
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

  // ─── 7. STORIES ──────────────────────────────────────────────────────
  L.push("## 7. Stories — canale di nurturing");
  L.push("");
  if (storyStats && storyStats.count > 0) {
    const cadenceLabel =
      storyStats.stories_per_week_avg != null
        ? `media **${storyStats.stories_per_week_avg}/settimana**`
        : `cadenza settimanale non significativa (solo ${storyStats.span_days}g coperti)`;
    L.push(
      `Catturate dal cron 4h durante le 24h di vita di ogni story (passata quella, IG le rimuove dalla lista). ${storyStats.count} stories in ${storyStats.span_days}g, ${cadenceLabel}.`
    );
    L.push("");
    L.push(`- **Reach medio per story**: ${fmtN(storyStats.reach_avg)} (totale ${fmtN(storyStats.reach_total)})`);
    L.push(`- **Reply rate**: ${pct(storyStats.reply_rate_pct)} (${storyStats.replies_total} risposte / ${fmtN(storyStats.reach_total)} reach) — il DM è high-effort, è il segnale di affinità più forte`);
    L.push(`- **Navigation per reach**: ${storyStats.navigation_per_reach}× — azioni di tap-forward/back/exit per visione`);
    L.push(`- **Total interactions rate**: ${pct(storyStats.interactions_rate_pct)}`);
    if (storyStats.top_story) {
      const t = storyStats.top_story;
      L.push("");
      L.push(`**Top story**: ${t.media_type} del ${fmtDateShort(t.timestamp)} — reach ${fmtN(t.reach)}, ${t.replies} replies, ${fmtN(t.navigation)} navigation`);
    }
    L.push("");
    if (narrative?.storiesTake) {
      L.push(narrative.storiesTake);
      L.push("");
    }
  } else {
    L.push(
      "_Nessuna story tracciata nel periodo. Le stories sono il canale di nurturing per l'audience che ti segue già (vs il feed che cerca nuovi follower) — un account piccolo che le ignora rinuncia al tasto più diretto sulla community esistente._"
    );
    L.push("");
  }

  // ─── 8. TOP 5 weighted (qualità segnale) ──────────────────────────────
  L.push("## 8. Top 5 — qualità del segnale");
  L.push("");
  L.push(
    "_Score ponderato = `shares×4 + saved×3 + comments×2 + likes×1`. Misura la **qualità** del segnale (uno share vale 4 like)._"
  );
  L.push("");
  if (weightedEngagement?.top5_by_weighted?.length) {
    L.push("| Data | Tipo | Score | Score/reach | Reach | Caption |");
    L.push("|---|---|---:|---:|---:|---|");
    for (const p of weightedEngagement.top5_by_weighted) {
      const cap = (p.caption_preview || "").slice(0, 60).replace(/\|/g, "\\|").replace(/\n+/g, " ");
      L.push(
        `| ${fmtDateShort(p.timestamp)} | ${p.media_type} | **${p.weighted_score}** | ${pct(p.weighted_score_per_reach)} | ${fmtN(p.reach)} | ${cap}${(p.caption_preview || "").length > 60 ? "…" : ""} |`
      );
    }
    L.push("");
  }
  if (narrative?.topPattern) {
    L.push(`**Pattern dei vincenti**: ${narrative.topPattern}`);
    L.push("");
  }

  // ─── 9. BOTTOM 5 weighted ─────────────────────────────────────────────
  L.push("## 9. Bottom 5 — sotto-performer");
  L.push("");
  if (weightedEngagement?.bottom5_by_weighted?.length) {
    L.push("_Filtrati su reach ≥ 50 (no rumore) ed esclusi dai top — ordinati per score ponderato crescente._");
    L.push("");
    L.push("| Data | Tipo | Score | Score/reach | Reach | Caption |");
    L.push("|---|---|---:|---:|---:|---|");
    for (const p of weightedEngagement.bottom5_by_weighted) {
      const cap = (p.caption_preview || "").slice(0, 60).replace(/\|/g, "\\|").replace(/\n+/g, " ");
      L.push(
        `| ${fmtDateShort(p.timestamp)} | ${p.media_type} | ${p.weighted_score} | ${pct(p.weighted_score_per_reach)} | ${fmtN(p.reach)} | ${cap}${(p.caption_preview || "").length > 60 ? "…" : ""} |`
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

  // ─── 10. COHORT — early vs late ─────────────────────────────────────────
  if (cohortComparison) {
    L.push("## 10. Cohort: stai migliorando o stallando?");
    L.push("");
    const trendLabels = {
      improving: "🟢 IN MIGLIORAMENTO",
      stalling: "🟡 STALLO",
      degrading: "🔴 IN PEGGIORAMENTO",
    };
    L.push(`### Trend: **${trendLabels[cohortComparison.trend] || cohortComparison.trend}**`);
    L.push("");
    L.push("| Cohort | Post | Reach medio | ER medio | Saved | Shares |");
    L.push("|---|---:|---:|---:|---:|---:|");
    L.push(
      `| **Early** (${cohortComparison.early.period_label}) | ${cohortComparison.early.count} | ${fmtN(cohortComparison.early.avg_reach)} | ${pct(cohortComparison.early.avg_er)} | ${cohortComparison.early.avg_saved.toFixed(1)} | ${cohortComparison.early.avg_shares.toFixed(1)} |`
    );
    L.push(
      `| **Late** (${cohortComparison.late.period_label}) | ${cohortComparison.late.count} | ${fmtN(cohortComparison.late.avg_reach)} | ${pct(cohortComparison.late.avg_er)} | ${cohortComparison.late.avg_saved.toFixed(1)} | ${cohortComparison.late.avg_shares.toFixed(1)} |`
    );
    L.push(
      `| **Δ%** | — | ${cohortComparison.reach_delta_pct >= 0 ? "+" : ""}${cohortComparison.reach_delta_pct.toFixed(1)}% | ${cohortComparison.er_delta_pct >= 0 ? "+" : ""}${cohortComparison.er_delta_pct.toFixed(1)}% | — | — |`
    );
    L.push("");
    if (narrative?.cohortTake) {
      L.push(narrative.cohortTake);
      L.push("");
    }
  } else {
    L.push("## 10. Cohort: stai migliorando o stallando?");
    L.push("");
    L.push("_Campione troppo piccolo per cohort comparison (servono ≥ 10 post nella fase corrente)._");
    L.push("");
  }

  // ─── 11. CURVA FOLLOWER ──────────────────────────────────────────────
  L.push("## 11. Curva follower");
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

  // ─── 12. HYPOTHESIS TESTS ──────────────────────────────────────────────
  if (narrative?.hypothesisTests?.length) {
    L.push("## 12. Hypothesis tests");
    L.push("");
    L.push("_Ipotesi forti formulate dal data + verificate contro lo storico. Verdetto = CONFERMATA / RESPINTA / DATI INSUFFICIENTI._");
    L.push("");
    for (const h of narrative.hypothesisTests) {
      const verdictColor = {
        CONFERMATA: "🟢",
        RESPINTA: "🔴",
        "DATI INSUFFICIENTI": "🟡",
      };
      const icon = verdictColor[h.verdict] || "•";
      L.push(`### ${icon} ${h.verdict || "—"}`);
      L.push(`**Ipotesi**: ${h.hypothesis}`);
      if (h.verification) L.push(`**Verifica**: ${h.verification}`);
      if (h.implication) L.push(`**Implicazione**: ${h.implication}`);
      L.push("");
    }
  }

  // ─── 13. VERITÀ SCOMODE ────────────────────────────────────────────────
  L.push("## 13. Verità scomode");
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

  // ─── 14. A/B TEST PLAN ─────────────────────────────────────────────────
  if (narrative?.abTests?.length) {
    L.push("## 14. A/B test plan");
    L.push("");
    L.push("_Esperimenti realmente eseguibili nei prossimi 30g per generare evidenze nuove (non opinioni)._");
    L.push("");
    for (const t of narrative.abTests) {
      L.push(`### ${t.name || "Test"}`);
      L.push(`- **Ipotesi**: ${t.hypothesis}`);
      L.push(`- **Variant** (cosa cambia): ${t.variant}`);
      L.push(`- **Control** (baseline): ${t.control}`);
      L.push(`- **KPI primario**: ${t.primary_kpi}`);
      L.push(`- **Sample**: ${t.sample}${t.duration_days ? ` · **Durata**: ${t.duration_days}g` : ""}`);
      L.push("");
    }
  }

  // ─── 15. STRATEGIA 30 GIORNI ───────────────────────────────────────────
  L.push("## 15. Strategia 30 giorni");
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
    `- Top/Bottom (sezioni 8-9) calcolati su **score ponderato** \`shares×4 + saved×3 + comments×2 + likes×1\` — riflette qualità del segnale, non quantità.`
  );
  L.push(
    `- Bottom 5 filtrati su reach ≥ 50 (no rumore) ed esclusi quelli già nei Top.`
  );
  L.push(
    `- Pulp Index (cockpit) = score 0-100 composito su cadence (0-25) + variety (0-15) + engagement (0-25) + growth (0-20) + caption_depth (0-15). Grade A+ ≥90, A ≥80, B+ ≥70, B ≥60, C+ ≥50, C ≥40, D ≥30, F sotto.`
  );
  L.push(
    `- Cohort early-vs-late confronta i primi 5 post post-ripartenza con gli ultimi 5. Trend "improving" se reach late ≥ +10% rispetto a early, "degrading" se ≤ -10%, sennò "stalling".`
  );
  L.push(
    `- Hypothesis tests e A/B test plan generati dal LLM ma calibrati sul payload effettivo — i numeri citati sono verificabili sul dump JSON che il modello ha ricevuto.`
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
    const { daily, posts, audience, audienceDate, stories } = await loadAll(db);
    if (!daily.length || !posts.length) {
      const msg = "Storico vuoto: lancia 'npm run snapshot' qualche volta prima di generare il deep report.";
      console.error(msg);
      await endRunLog(runId, { status: "error", error: msg });
      process.exit(1);
    }

    // Restart detection: se c'e' stato un buco lungo, l'analisi che segue
    // lavora SOLO su post + daily + stories post-ripartenza. La vita
    // pre-pausa diventa un fatto storico citato una volta in Identita.
    const restart = detectRestart(posts);
    const postsActive = restart
      ? posts.filter((p) => p.timestamp >= restart.restart_iso)
      : posts;
    const dailyActive = restart
      ? daily.filter((d) => d.date >= restart.restart_date_only)
      : daily;
    const storiesActive = restart
      ? stories.filter((s) => s.timestamp >= restart.restart_iso)
      : stories;
    if (restart) {
      console.log(
        `Restart rilevato: pausa di ${restart.pause_days}g, ripartenza il ${restart.restart_date_only}. ` +
          `Analisi limitata ai ${postsActive.length} post post-ripartenza (esclusi ${restart.pre_pause_post_count} pre-pausa).`
      );
    }
    console.log(
      `Caricati: ${dailyActive.length} daily · ${postsActive.length} post · audience ${audienceDate || "n/a"}`
    );

    // Live profile da Graph API per i valori "ora" (follower/following/media)
    console.log("Fetch live profile da Graph API...");
    const liveProfile = await fetchLiveProfile();
    if (liveProfile) {
      console.log(
        `Live: ${liveProfile.followers_count} follower (snapshot Turso ultimo: ${dailyActive[dailyActive.length - 1]?.followers ?? "n/a"})`
      );
    }

    const identity = computeIdentity(dailyActive, postsActive, restart, posts.length, liveProfile);
    const cadence = computeCadence(postsActive);
    const byType = computePerformanceByType(postsActive);
    const followerTrend = computeFollowerTrend(dailyActive);
    const topBottom = topBottomPosts(postsActive, 5);
    const audSummary = audienceSummary(audience);
    const storyStats = computeStoryStats(storiesActive);
    const captionForensics = computeCaptionForensics(postsActive);
    const hourDowMatrix = computeHourDowMatrix(postsActive);
    const cohortComparison = computeCohortComparison(postsActive, 5);
    const weightedEngagement = computeWeightedEngagement(postsActive);
    const contentDebt = computeContentDebt(postsActive);
    const pulpIndex = computePulpIndex(identity, cadence, byType, followerTrend, contentDebt, captionForensics);

    // Payload per LLM: SOLO post post-ripartenza (se restart rilevato).
    // La pausa precedente e' un fact-only nel campo identity.restart.
    const llmPayload = {
      identity,
      cadence,
      performance_by_type: byType,
      follower_trend: followerTrend,
      audience: { date: audienceDate, ...audSummary },
      stories: storyStats,
      caption_forensics: captionForensics,
      hour_dow_matrix: hourDowMatrix,
      cohort: cohortComparison,
      weighted_engagement: weightedEngagement,
      content_debt: contentDebt,
      pulp_index: pulpIndex,
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
      storyStats,
      narrative,
      posts: postsActive,
      captionForensics,
      hourDowMatrix,
      cohortComparison,
      weightedEngagement,
      contentDebt,
      pulpIndex,
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
