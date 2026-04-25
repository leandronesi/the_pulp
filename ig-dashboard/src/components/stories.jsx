import { useState, useMemo } from "react";
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { CircleDot } from "lucide-react";
import { fmt } from "../utils/format.js";

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
// Mostriamo: KPI aggregati ultimi 7g + lista cronologica con curva di
// consumo durante le 24h di vita di ogni story.
export function StoriesTab({ stories, storyHistory }) {
  const [windowDays, setWindowDays] = useState(7);
  const cutoffMs = Date.now() - windowDays * 86400000;
  const inWindow = stories.filter(
    (s) => new Date(s.timestamp).getTime() >= cutoffMs
  );

  const aggregates = useMemo(() => {
    if (!inWindow.length) return null;
    const totals = inWindow.reduce(
      (acc, s) => ({
        reach: acc.reach + (s.reach || 0),
        replies: acc.replies + (s.replies || 0),
        navigation: acc.navigation + (s.navigation || 0),
        shares: acc.shares + (s.shares || 0),
        interactions: acc.interactions + (s.total_interactions || 0),
      }),
      { reach: 0, replies: 0, navigation: 0, shares: 0, interactions: 0 }
    );
    const reachAvg = totals.reach / inWindow.length;
    const replyRate = totals.reach > 0 ? (totals.replies / totals.reach) * 100 : 0;
    const navRate = totals.reach > 0 ? totals.navigation / totals.reach : 0;
    const interRate = totals.reach > 0 ? (totals.interactions / totals.reach) * 100 : 0;
    return {
      count: inWindow.length,
      reachAvg,
      replyRate,
      navRate,
      interRate,
      ...totals,
    };
  }, [inWindow]);

  if (!stories.length) {
    return (
      <div className="glass rounded-3xl p-8 text-center">
        <CircleDot
          size={32}
          className="mx-auto mb-3 text-white/30"
        />
        <h3 className="display-font text-xl text-white/80 mb-2">
          Nessuna story in archivio
        </h3>
        <p className="text-xs text-white/40 mono-font max-w-md mx-auto leading-relaxed">
          Le stories vengono catturate dal cron `snapshot:fresh` ogni 4h, prima
          che IG le scada (24h). Pubblica una story e aspetta il prossimo cron
          — oppure lancia manualmente <code>npm run snapshot:fresh</code>.
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
            Catturate dal cron 4h durante le 24h di vita. {inWindow.length} stories negli ultimi {windowDays}g.
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

      {aggregates && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 fadein">
          <StoryKpi
            label="STORIES PUBBLICATE"
            value={aggregates.count}
            sublabel={`ultimi ${windowDays}g`}
          />
          <StoryKpi
            label="REACH MEDIO"
            value={Math.round(aggregates.reachAvg)}
            sublabel={`tot ${fmt(aggregates.reach)}`}
          />
          <StoryKpi
            label="REPLY RATE"
            value={aggregates.replyRate.toFixed(1) + "%"}
            sublabel={`${aggregates.replies} risposte / ${aggregates.reach} reach`}
            tier={
              aggregates.replyRate > 1.5
                ? { label: "forte", color: "#7FB3A3" }
                : aggregates.replyRate > 0.5
                ? { label: "medio", color: "#D4A85C" }
                : { label: "basso", color: "#D98B6F" }
            }
          />
          <StoryKpi
            label="NAVIGATION / REACH"
            value={aggregates.navRate.toFixed(2) + "×"}
            sublabel="azioni di navigazione per visione"
          />
        </section>
      )}

      <section className="space-y-3 fadein">
        {inWindow.map((s) => (
          <StoryRow key={s.id} story={s} history={storyHistory[s.id] || []} />
        ))}
      </section>

      <div className="mt-8 text-[11px] text-white/40 mono-font leading-relaxed">
        <p className="mb-1"><strong>KPI specifici stories</strong> (diversi dai post):</p>
        <ul className="list-disc list-inside space-y-0.5 ml-1">
          <li><strong>Reply rate</strong>: replies/reach × 100. Il reply via DM è high-effort, segnale forte di affinità.</li>
          <li><strong>Navigation/reach</strong>: somma di tap-forward, tap-back, swipe-forward, exits per visione. Valori &gt;1 = molto attive.</li>
          <li><strong>Total interactions</strong>: aggregato di tutte le interazioni dirette (replies + reactions + altre).</li>
        </ul>
      </div>
    </>
  );
}

export function StoryKpi({ label, value, sublabel, tier }) {
  return (
    <div className="glass rounded-2xl p-4 flex flex-col gap-1">
      <div className="text-[10px] mono-font tracking-wider text-white/40 uppercase">
        {label}
      </div>
      <div className="display-font text-2xl text-white font-light">{value}</div>
      {sublabel && (
        <div className="text-[10px] mono-font text-white/40">{sublabel}</div>
      )}
      {tier && (
        <span
          className="inline-flex self-start items-center gap-1 rounded-full px-2 py-0.5 text-[10px] mono-font uppercase tracking-wider mt-1"
          style={{
            backgroundColor: tier.color + "26",
            color: tier.color,
          }}
        >
          {tier.label}
        </span>
      )}
    </div>
  );
}

export function StoryRow({ story, history }) {
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
  const replyRate =
    story.reach > 0 ? (story.replies / story.reach) * 100 : 0;
  const interRate =
    story.reach > 0 ? (story.total_interactions / story.reach) * 100 : 0;
  // Sparkline: curva del reach durante la vita della story (5-6 punti tipici).
  const spark = (history || []).filter((h) => h.reach > 0);

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
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-1 mt-1">
          <StoryMetric label="reach" value={story.reach} />
          <StoryMetric label="replies" value={story.replies} sub={replyRate ? replyRate.toFixed(1) + "%" : null} />
          <StoryMetric label="nav" value={story.navigation} />
          <StoryMetric label="shares" value={story.shares} />
          <StoryMetric label="inter" value={story.total_interactions} sub={interRate ? interRate.toFixed(1) + "%" : null} />
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
