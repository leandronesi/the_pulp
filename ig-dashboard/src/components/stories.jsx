import { useState, useMemo } from "react";
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { CircleDot, TrendingUp, AlertCircle, Sparkles } from "lucide-react";
import { fmt } from "../utils/format.js";
import { DeltaPill } from "./kpi-cards.jsx";
import { InfoTip } from "./tooltips.jsx";
import {
  storyReachRateTier,
  storyReplyRateTier,
  storyNavRateTier,
} from "../utils/tiers.js";

// Mini-strip in Overview: invita a vedere la tab Stories.
// Niente quando l'archivio e' vuoto (account senza stories tracciate).
export function StoriesStrip({ stories, onJump }) {
  const last7 = useMemo(() => {
    const cut = Date.now() - 7 * 86400000;
    return (stories || []).filter(
      (s) => new Date(s.timestamp).getTime() >= cut
    );
  }, [stories]);
  if (!last7.length) return null;
  const totalReach = last7.reduce((a, s) => a + (s.reach || 0), 0);
  const totalReplies = last7.reduce((a, s) => a + (s.replies || 0), 0);
  const replyRate = totalReach > 0 ? (totalReplies / totalReach) * 100 : 0;
  const reachAvg = totalReach / last7.length;
  return (
    <button
      onClick={onJump}
      className="glass rounded-2xl px-5 py-3 mb-10 flex items-center gap-4 text-left w-full hover:bg-white/5 transition fadein flex-wrap"
    >
      <div className="flex items-center gap-2 text-[#7FB3A3]">
        <CircleDot size={16} />
        <span className="text-[10px] mono-font tracking-wider uppercase">
          Stories ultimi 7g
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="display-font text-2xl text-white">{last7.length}</span>
        <span className="text-[10px] mono-font text-white/40 ml-1">pubblicate</span>
      </div>
      <span className="text-white/20">·</span>
      <div className="flex items-baseline gap-1">
        <span className="text-sm text-white">{Math.round(reachAvg)}</span>
        <span className="text-[10px] mono-font text-white/40">reach medio</span>
      </div>
      <span className="text-white/20">·</span>
      <div className="flex items-baseline gap-1">
        <span className="text-sm text-white">{replyRate.toFixed(1)}%</span>
        <span className="text-[10px] mono-font text-white/40">reply rate</span>
      </div>
      <span className="ml-auto text-[10px] mono-font text-white/40 hover:text-white/70">
        apri tab →
      </span>
    </button>
  );
}

// ─── Stories tab ─────────────────────────────────────────────────────────
// Stories vivono in Turso (catturate dal cron 4h prima della scadenza 24h IG).
// Layout: insight bar narrativo + 4 KPI tile con delta vs prec + highlight
// strip (top/bottom story) + lista cronologica con tier + drop-off.
export function StoriesTab({ stories, storyHistory, followersCount }) {
  const [windowDays, setWindowDays] = useState(7);
  const cutoffMs = Date.now() - windowDays * 86400000;
  const prevCutoffMs = Date.now() - 2 * windowDays * 86400000;

  const inWindow = useMemo(
    () => stories.filter((s) => new Date(s.timestamp).getTime() >= cutoffMs),
    [stories, cutoffMs]
  );
  const inPrevWindow = useMemo(
    () =>
      stories.filter((s) => {
        const t = new Date(s.timestamp).getTime();
        return t >= prevCutoffMs && t < cutoffMs;
      }),
    [stories, prevCutoffMs, cutoffMs]
  );

  // Aggregati: count, reach (avg + total), replies + reply rate, navigation/reach,
  // total interactions / reach. Calcolati sia per il periodo sia per il prec.
  // Il delta per ogni KPI è (cur - prev) / prev * 100.
  const aggregates = useMemo(() => buildAggregates(inWindow), [inWindow]);
  const prevAggregates = useMemo(
    () => buildAggregates(inPrevWindow),
    [inPrevWindow]
  );

  // Per ogni story: sparkline curva reach + drop-off ("satura a Nh" o "live").
  // Drop-off = momento in cui il reach ha raggiunto il 90% del finale.
  const enrichedStories = useMemo(
    () =>
      inWindow.map((s) => {
        const hist = storyHistory?.[s.id] || [];
        return {
          ...s,
          dropOffHours: computeDropOff(s, hist),
          history: hist,
        };
      }),
    [inWindow, storyHistory]
  );

  // Top/bottom: per reach (la metrica più sensata da rankare a livello story).
  // Se ci sono <2 stories, niente highlight (banale).
  const { topStory, bottomStory } = useMemo(() => {
    if (enrichedStories.length < 2) return { topStory: null, bottomStory: null };
    const sorted = [...enrichedStories].sort(
      (a, b) => (b.reach || 0) - (a.reach || 0)
    );
    return {
      topStory: sorted[0],
      bottomStory: sorted[sorted.length - 1],
    };
  }, [enrichedStories]);

  // Insight rules-based: 3-5 frasi sintetiche letta a colpo d'occhio.
  const insights = useMemo(
    () => buildInsights({ aggregates, prevAggregates, enrichedStories, windowDays }),
    [aggregates, prevAggregates, enrichedStories, windowDays]
  );

  if (!stories.length) {
    return (
      <div className="glass rounded-3xl p-8 text-center">
        <CircleDot size={32} className="mx-auto mb-3 text-white/30" />
        <h3 className="display-font text-xl text-white/80 mb-2">
          Nessuna story in archivio
        </h3>
        <p className="text-xs text-white/40 mono-font max-w-md mx-auto leading-relaxed">
          Le stories vengono catturate dal cron `snapshot:fresh` ogni ora,
          prima che IG le scada (24h). Pubblica una story e aspetta il
          prossimo cron — oppure lancia manualmente <code>npm run snapshot:fresh</code>.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 fadein flex items-baseline justify-between flex-wrap gap-3">
        <div>
          <h2 className="display-font text-3xl text-white font-light">
            <span className="italic">stories</span>
          </h2>
          <p className="text-xs text-white/50 mono-font mt-2">
            Catturate dal cron orario durante le 24h di vita. {inWindow.length} stories negli ultimi {windowDays}g.
          </p>
        </div>
        <div className="glass rounded-full px-2 py-1 flex items-center gap-1">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setWindowDays(d)}
              className={`px-3 py-1.5 text-xs rounded-full transition mono-font ${
                windowDays === d
                  ? "bg-[#EDE5D0] text-[#0B3A30] font-semibold"
                  : "text-white/60 hover:text-white"
              }`}
            >
              {d}g
            </button>
          ))}
        </div>
      </div>

      {insights.length > 0 && <InsightsBar insights={insights} />}

      {aggregates && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 fadein">
          <StoryKpi
            label="STORIES PUBBLICATE"
            value={aggregates.count}
            sublabel={`ultimi ${windowDays}g`}
            deltaPct={
              prevAggregates && prevAggregates.count > 0
                ? ((aggregates.count - prevAggregates.count) / prevAggregates.count) * 100
                : null
            }
          />
          <StoryKpi
            label="REACH MEDIO"
            value={Math.round(aggregates.reachAvg)}
            sublabel={
              followersCount
                ? `${((aggregates.reachAvg / followersCount) * 100).toFixed(0)}% dei follower`
                : `tot ${fmt(aggregates.reach)}`
            }
            deltaPct={
              prevAggregates && prevAggregates.reachAvg > 0
                ? ((aggregates.reachAvg - prevAggregates.reachAvg) / prevAggregates.reachAvg) * 100
                : null
            }
            tier={
              followersCount
                ? storyReachRateTier((aggregates.reachAvg / followersCount) * 100)
                : null
            }
          />
          <StoryKpi
            label="REPLY RATE"
            value={aggregates.replyRate.toFixed(1) + "%"}
            sublabel={`${aggregates.replies} risposte / ${fmt(aggregates.reach)} reach`}
            deltaPct={
              prevAggregates && prevAggregates.replyRate > 0
                ? ((aggregates.replyRate - prevAggregates.replyRate) / prevAggregates.replyRate) * 100
                : null
            }
            tier={storyReplyRateTier(aggregates.replyRate)}
          />
          <StoryKpi
            label="NAVIGATION / REACH"
            value={aggregates.navRate.toFixed(2) + "×"}
            sublabel="azioni di navigazione per visione"
            tier={storyNavRateTier(aggregates.navRate)}
          />
        </section>
      )}

      {(topStory || bottomStory) && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 fadein">
          {topStory && (
            <HighlightCard
              kind="top"
              story={topStory}
              avgReach={aggregates?.reachAvg || 0}
            />
          )}
          {bottomStory && bottomStory.id !== topStory?.id && (
            <HighlightCard
              kind="bottom"
              story={bottomStory}
              avgReach={aggregates?.reachAvg || 0}
            />
          )}
        </section>
      )}

      <section className="space-y-3 fadein">
        {enrichedStories.map((s) => (
          <StoryRow
            key={s.id}
            story={s}
            history={s.history}
            avgReach={aggregates?.reachAvg || 0}
          />
        ))}
      </section>

      <div className="mt-8 text-[11px] text-white/40 mono-font leading-relaxed">
        <p className="mb-1"><strong>KPI specifici stories</strong> (diversi dai post):</p>
        <ul className="list-disc list-inside space-y-0.5 ml-1">
          <li><strong>Reply rate</strong>: replies/reach × 100. Il reply via DM è high-effort, segnale forte di affinità.</li>
          <li><strong>Navigation/reach</strong>: somma di tap-forward, tap-back, swipe-forward, exits per visione. Valori &gt;1 = molto attive (skip o interazione interna).</li>
          <li><strong>Drop-off</strong>: ora dalla pubblicazione in cui la curva reach raggiunge il 90% del valore finale = quando la story ha smesso di crescere.</li>
        </ul>
      </div>
    </>
  );
}

// ─── Insight bar ─────────────────────────────────────────────────────────

function InsightsBar({ insights }) {
  return (
    <div className="glass rounded-2xl p-4 mb-6 fadein flex gap-3 items-start">
      <Sparkles size={16} className="text-[#D4A85C] shrink-0 mt-0.5" />
      <div className="flex-1 text-xs text-white/75 leading-relaxed">
        {insights.map((line, i) => (
          <p key={i} className={i > 0 ? "mt-1.5" : ""}>
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

function buildInsights({ aggregates, prevAggregates, enrichedStories, windowDays }) {
  const out = [];
  if (!aggregates) return out;

  // Cadenza vs prev period
  if (prevAggregates && prevAggregates.count > 0) {
    const dPct = ((aggregates.count - prevAggregates.count) / prevAggregates.count) * 100;
    if (Math.abs(dPct) >= 20) {
      const dir = dPct > 0 ? "+" : "";
      out.push(
        `Hai pubblicato ${aggregates.count} stories negli ultimi ${windowDays}g (${dir}${dPct.toFixed(0)}% vs ${windowDays}g precedenti). ${
          dPct > 0
            ? "Cadenza in crescita — IG premia chi resta visibile."
            : "Cadenza in calo — la presenza tra le stories è la prima cosa che fa cadere il reach medio."
        }`
      );
    }
  } else if (aggregates.count > 0) {
    out.push(
      `${aggregates.count} stories pubblicate in ${windowDays}g, prima volta che misuriamo questa finestra.`
    );
  }

  // Reply rate qualitativo
  if (aggregates.replyRate > 1.5) {
    out.push(
      `Reply rate ${aggregates.replyRate.toFixed(1)}% — sopra l'1.5%, le tue stories generano DM. Audience profondamente affine, il canale story è un asset.`
    );
  } else if (aggregates.replyRate < 0.3 && aggregates.count >= 5) {
    out.push(
      `Reply rate ${aggregates.replyRate.toFixed(1)}% — basso. Le stories vengono guardate ma non innescano risposta. Prova call-to-action esplicite (sticker domanda, sondaggio).`
    );
  }

  // Pattern nav vs reply
  if (aggregates.navRate > 1.5 && aggregates.replyRate < 0.5 && aggregates.count >= 5) {
    out.push(
      "Navigazione alta + reply bassi: la gente naviga (skip o exit) ma non risponde. Probabile dominanza tap-forward = i primi frame non agganciano abbastanza."
    );
  }

  // Drop-off precoce
  const validDropOffs = enrichedStories
    .map((s) => s.dropOffHours)
    .filter((h) => h != null && h > 0 && h < 24);
  if (validDropOffs.length >= 3) {
    const avgDrop = validDropOffs.reduce((a, b) => a + b, 0) / validDropOffs.length;
    if (avgDrop < 6) {
      out.push(
        `Drop-off medio ${avgDrop.toFixed(1)}h: le tue stories saturano in poche ore. È normale, ma se vuoi farle "vivere" più a lungo prova a pubblicare in slot diversi della giornata.`
      );
    } else if (avgDrop > 12) {
      out.push(
        `Drop-off medio ${avgDrop.toFixed(1)}h: le tue stories continuano a raccogliere reach per metà della loro vita. Pattern forte, raro per account piccoli.`
      );
    }
  }

  return out;
}

// ─── Highlight card (top/bottom story) ───────────────────────────────────

function HighlightCard({ kind, story, avgReach }) {
  const isTop = kind === "top";
  const accent = isTop ? "#7FB3A3" : "#D98B6F";
  const label = isTop ? "TOP DEL PERIODO" : "FONDO DEL PERIODO";
  const icon = isTop ? <TrendingUp size={14} /> : <AlertCircle size={14} />;
  const reach = story.reach || 0;
  const ratio = avgReach > 0 ? reach / avgReach : 1;
  const explanation = isTop
    ? `${reach} reach (${ratio.toFixed(1)}× la media del periodo)${
        story.replies > 0
          ? `, ${story.replies} ${story.replies === 1 ? "risposta" : "risposte"} via DM`
          : ""
      }.`
    : `${reach} reach (${ratio.toFixed(1)}× la media). ${
        avgReach - reach > 0
          ? `Sotto la media di ${Math.round(avgReach - reach)} account unici.`
          : ""
      }`;
  const when = new Date(story.timestamp).toLocaleString("it-IT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className="glass rounded-2xl p-4 flex gap-4">
      <div className="w-16 h-20 shrink-0 rounded-xl overflow-hidden bg-black/40 flex items-center justify-center">
        {story.thumbnail_url || story.media_url ? (
          <img
            src={story.thumbnail_url || story.media_url}
            alt=""
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        ) : (
          <CircleDot size={20} className="text-white/30" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className="inline-flex items-center gap-1.5 text-[10px] mono-font tracking-wider uppercase mb-1"
          style={{ color: accent }}
        >
          {icon}
          {label}
        </div>
        <div className="text-xs mono-font text-white/60 mb-1.5">{when}</div>
        <p className="text-sm text-white/85 leading-relaxed">{explanation}</p>
      </div>
    </div>
  );
}

// ─── Aggregate / drop-off helpers ────────────────────────────────────────

function buildAggregates(stories) {
  if (!stories.length) return null;
  const totals = stories.reduce(
    (acc, s) => ({
      reach: acc.reach + (s.reach || 0),
      replies: acc.replies + (s.replies || 0),
      navigation: acc.navigation + (s.navigation || 0),
      shares: acc.shares + (s.shares || 0),
      interactions: acc.interactions + (s.total_interactions || 0),
    }),
    { reach: 0, replies: 0, navigation: 0, shares: 0, interactions: 0 }
  );
  const reachAvg = totals.reach / stories.length;
  const replyRate = totals.reach > 0 ? (totals.replies / totals.reach) * 100 : 0;
  const navRate = totals.reach > 0 ? totals.navigation / totals.reach : 0;
  const interRate =
    totals.reach > 0 ? (totals.interactions / totals.reach) * 100 : 0;
  return {
    count: stories.length,
    reachAvg,
    replyRate,
    navRate,
    interRate,
    ...totals,
  };
}

// Drop-off = ore dalla pubblicazione in cui il reach ha raggiunto il 90%
// del valore finale catturato. Indica quando la story ha smesso di crescere.
// Ritorna null se non ci sono abbastanza snapshot o se la story è ancora live
// (<24h dalla pubblicazione e ultimo reach in crescita).
function computeDropOff(story, history) {
  if (!history || history.length < 2) return null;
  const sorted = [...history]
    .filter((h) => h.reach > 0)
    .sort((a, b) => a.t - b.t);
  if (sorted.length < 2) return null;
  const finalReach = sorted[sorted.length - 1].reach;
  const target = finalReach * 0.9;
  const publishedTs = new Date(story.timestamp).getTime();
  for (const h of sorted) {
    if (h.reach >= target) {
      const hours = (h.t - publishedTs) / 3600000;
      return hours > 0 ? hours : null;
    }
  }
  return null;
}

// ─── KPI tile (unchanged interface, ora supporta deltaPct) ───────────────

export function StoryKpi({ label, value, sublabel, tier, deltaPct }) {
  return (
    <div className="glass rounded-2xl p-4 flex flex-col gap-1">
      <div className="text-[10px] mono-font tracking-wider text-white/40 uppercase">
        {label}
      </div>
      <div className="display-font text-2xl text-white font-light">{value}</div>
      {sublabel && (
        <div className="text-[10px] mono-font text-white/40">{sublabel}</div>
      )}
      <div className="flex items-center gap-2 flex-wrap mt-1">
        {deltaPct != null && Number.isFinite(deltaPct) && (
          <DeltaPill value={deltaPct} />
        )}
        {tier && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] mono-font uppercase tracking-wider"
            style={{ backgroundColor: tier.color + "26", color: tier.color }}
          >
            {tier.label}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Story row (con tier + drop-off) ─────────────────────────────────────

export function StoryRow({ story, history, avgReach }) {
  const when = new Date(story.timestamp).toLocaleString("it-IT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const hoursOld = Math.floor(
    (Date.now() - new Date(story.timestamp).getTime()) / 3600000
  );
  const isLive = hoursOld < 24;
  const replyRate = story.reach > 0 ? (story.replies / story.reach) * 100 : 0;
  const interRate =
    story.reach > 0 ? (story.total_interactions / story.reach) * 100 : 0;
  const spark = (history || []).filter((h) => h.reach > 0);

  // Tier per-story: confronto del reach contro la media del periodo.
  // Niente tier se la media è 0 o se la story è la sola del periodo.
  const reachRatio = avgReach > 0 ? story.reach / avgReach : 1;
  const perStoryTier =
    avgReach > 0 && story.reach > 0
      ? reachRatio >= 1.3
        ? { label: "forte", color: "#7FB3A3" }
        : reachRatio >= 0.8
        ? { label: "media", color: "#D4A85C" }
        : { label: "fiacca", color: "#D98B6F" }
      : null;

  const dropOffLabel = story.dropOffHours
    ? `satura a ${story.dropOffHours.toFixed(1)}h`
    : null;

  return (
    <div className="glass rounded-2xl p-4 flex gap-4 items-stretch">
      <div className="w-16 h-20 sm:w-20 sm:h-24 shrink-0 rounded-xl overflow-hidden bg-black/40 flex items-center justify-center">
        {story.thumbnail_url || story.media_url ? (
          <img
            src={story.thumbnail_url || story.media_url}
            alt=""
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <CircleDot size={20} className="text-white/30" />
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs mono-font text-white/70">{when}</span>
          <span className="text-[10px] mono-font text-white/40 uppercase tracking-wider">
            {story.media_type}
          </span>
          {isLive && (
            <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] mono-font uppercase tracking-wider bg-[#7FB3A3]/20 text-[#7FB3A3]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#7FB3A3] animate-pulse" />
              live
            </span>
          )}
          {perStoryTier && (
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] mono-font uppercase tracking-wider"
              style={{
                backgroundColor: perStoryTier.color + "20",
                color: perStoryTier.color,
              }}
            >
              {perStoryTier.label}
            </span>
          )}
          {dropOffLabel && !isLive && (
            <span className="text-[10px] mono-font text-white/40">
              · {dropOffLabel}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-1 mt-1">
          <StoryMetric label="reach" value={story.reach} />
          <StoryMetric
            label="replies"
            value={story.replies}
            sub={replyRate ? replyRate.toFixed(1) + "%" : null}
          />
          <StoryMetric label="nav" value={story.navigation} />
          <StoryMetric label="shares" value={story.shares} />
          <StoryMetric
            label="inter"
            value={story.total_interactions}
            sub={interRate ? interRate.toFixed(1) + "%" : null}
          />
        </div>
      </div>
      {spark.length >= 2 && (
        <div className="w-24 sm:w-32 h-16 sm:h-20 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
              <Area
                type="monotone"
                dataKey="reach"
                stroke="#EDE5D0"
                strokeWidth={1.5}
                fill="#EDE5D0"
                fillOpacity={0.15}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function StoryMetric({ label, value, sub }) {
  return (
    <div>
      <div className="text-[10px] mono-font text-white/40 uppercase">{label}</div>
      <div className="text-sm text-white">
        {value ?? "—"}
        {sub && <span className="text-white/40 text-[10px] mono-font ml-1">{sub}</span>}
      </div>
    </div>
  );
}
