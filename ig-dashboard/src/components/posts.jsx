import React from "react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  Heart,
  Bookmark,
  Calendar,
  Film,
  Share2,
  Image as ImageIcon,
} from "lucide-react";
import { fmt, fmtDate } from "../utils/format.js";
import {
  MEDIA_TYPE_LABELS,
  MEDIA_TYPE_COLORS,
} from "../utils/tiers.js";
import {
  CURVE_TYPE_META,
  isVideoLikeMedia,
} from "../analytics.js";
import { Sparkline, ContentMixStat } from "./kpi-cards.jsx";

// ─── CONTENT_MIX_COPY ─────────────────────────────────────────────────────────
const CONTENT_MIX_COPY = {
  avgReach:
    "Media del reach dei post di questo formato. Formula: reach totale diviso numero di post.",
  avgEr:
    "Engagement rate del formato. Formula: interazioni totali diviso reach totale x 100. Interazioni = like + commenti + salvataggi + condivisioni.",
  avgVelocity:
    "Velocita di distribuzione. Per ogni post: reach osservato diviso giorni osservati, fino a 7 giorni. Qui vedi la media del formato, espressa come reach al giorno.",
};

// ─── ContentTypeTile ──────────────────────────────────────────────────────────
export function ContentTypeTile({ data }) {
  return (
    <div className="glass rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: MEDIA_TYPE_COLORS[data.type] }}
        />
        <span className="text-xs mono-font uppercase tracking-wider text-white/70">
          {MEDIA_TYPE_LABELS[data.type]}
        </span>
      </div>
      <div className="display-font text-3xl text-white font-light mb-1">
        {data.count}
      </div>
      <div className="text-[10px] mono-font text-white/40 uppercase tracking-wider">
        post
      </div>
      {data.count > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-2 gap-2 text-[11px] mono-font">
          <ContentMixStat
            label="Reach medio"
            info={CONTENT_MIX_COPY.avgReach}
            value={fmt(data.avgReach)}
          />
          <ContentMixStat
            label="ER medio"
            info={CONTENT_MIX_COPY.avgEr}
            value={`${data.avgEr.toFixed(1)}%`}
          />
          <ContentMixStat
            label="Reach/giorno"
            info={CONTENT_MIX_COPY.avgVelocity}
            value={fmt(data.avgVelocity)}
          />
        </div>
      )}
      {data.outlierCount > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-[10px] mono-font">
          <span className="text-white/40 uppercase tracking-wider">
            outlier
          </span>
          <span className="text-[#EDE5D0] font-semibold">
            {data.outlierCount}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── LifecycleMiniChart ───────────────────────────────────────────────────────
export function LifecycleMiniChart({ data }) {
  if (!data || data.length < 2) return null;
  return (
    <div>
      <ResponsiveContainer width="100%" height={70}>
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="monotone"
            dataKey="reachPct"
            stroke="#EDE5D0"
            strokeWidth={1.8}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="savedPct"
            stroke="#7FB3A3"
            strokeWidth={1.6}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-1 flex items-center gap-3 text-[9px] mono-font uppercase tracking-wider text-white/35">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-[2px] rounded-full bg-[#EDE5D0]" />
          reach
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-[2px] rounded-full bg-[#7FB3A3]" />
          saved
        </span>
      </div>
    </div>
  );
}

// ─── PostCard ─────────────────────────────────────────────────────────────────
export function PostCard({ post, rank }) {
  const thumb = post.thumbnail_url || post.media_url;
  const caption = (post.caption || "").slice(0, 80);
  const isVideo = isVideoLikeMedia(post);
  const curveMeta = CURVE_TYPE_META[post.curveType] || CURVE_TYPE_META.forming;
  return (
    <a
      href={post.permalink}
      target="_blank"
      rel="noopener noreferrer"
      className="glass rounded-2xl overflow-hidden block group transition hover:scale-[1.02]"
    >
      <div className="relative aspect-square bg-black/40 overflow-hidden">
        {thumb ? (
          <img
            src={thumb}
            alt=""
            className="w-full h-full object-cover group-hover:scale-110 transition duration-700"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/20">
            <ImageIcon size={40} />
          </div>
        )}
        <div className="absolute top-3 left-3 glass rounded-full px-3 py-1 text-xs mono-font text-white">
          #{rank}
        </div>
        {post.outlierFlag && (
          <div className="absolute top-12 left-3 rounded-full border border-[#EDE5D0]/40 bg-black/35 px-2 py-0.5 text-[9px] mono-font uppercase tracking-wider text-[#EDE5D0]">
            outlier
          </div>
        )}
        {isVideo && (
          <div className="absolute top-3 right-3 glass rounded-full p-2">
            <Film size={14} className="text-white" />
          </div>
        )}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent h-20" />
        <div className="absolute bottom-3 left-3 text-[10px] text-white/70 mono-font flex items-center gap-1">
          <Calendar size={10} /> {fmtDate(post.timestamp)}
        </div>
        <div className="absolute bottom-3 right-3 flex flex-col gap-1 items-end">
          {isVideo && post.views > 0 && (
            <span className="text-[10px] mono-font px-2 py-0.5 rounded-full bg-black/40 text-[#EDE5D0]">
              {fmt(post.views)} views
            </span>
          )}
          <span className="text-[10px] mono-font px-2 py-0.5 rounded-full bg-black/40 text-white/80">
            ER {post.er.toFixed(1)}%
          </span>
        </div>
      </div>
      <div className="p-4 sm:p-5">
        {caption && (
          <p className="text-white/70 text-xs mb-3 line-clamp-2 leading-relaxed">
            {caption}
            {post.caption?.length > 80 && "…"}
          </p>
        )}
        <div className="flex flex-wrap gap-2 mb-3">
          <span className="rounded-full px-2 py-0.5 text-[10px] mono-font bg-white/5 text-white/75">
            {fmt(post.velocity7d)}/g
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] mono-font"
            style={{
              backgroundColor: `${curveMeta.color}15`,
              color: curveMeta.color,
            }}
          >
            {curveMeta.label}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center pt-3 border-t border-white/5">
          <Metric
            icon={<TrendingUp size={11} />}
            value={fmt(post.reach)}
            label="reach"
          />
          <Metric
            icon={<Heart size={11} />}
            value={fmt(post.like_count)}
            label="like"
          />
          <Metric
            icon={<Bookmark size={11} />}
            value={fmt(post.saved)}
            label="salvati"
          />
          <Metric
            icon={<Share2 size={11} />}
            value={fmt(post.shares)}
            label="shares"
          />
        </div>
        {post.lifecycleSeries && post.lifecycleSeries.length >= 2 && (
          <div className="mt-3 pt-3 border-t border-white/5">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-[9px] text-white/30 mono-font uppercase tracking-wider">
                primi 7 giorni
              </div>
              <div className="text-[10px] text-white/45 italic" style={{ fontFamily: "Fraunces, serif" }}>
                osservato per {post.observedDays} {post.observedDays === 1 ? "giorno" : "giorni"}
              </div>
            </div>
            <LifecycleMiniChart data={post.lifecycleSeries} />
          </div>
        )}
      </div>
    </a>
  );
}

// ─── Metric ───────────────────────────────────────────────────────────────────
export function Metric({ icon, value, label }) {
  return (
    <div>
      <div className="flex items-center justify-center text-white/40 mb-1">
        {icon}
      </div>
      <div className="text-white text-sm mono-font font-semibold">{value}</div>
      <div className="text-[9px] text-white/30 mono-font uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
}

// ─── AudiencePanel ────────────────────────────────────────────────────────────
// `followersTotal` opzionale: se passato, mostra "mappati X / Y" nell'header
// — onestà sul fatto che IG follower_demographics non copre tutti i follower
// (privacy strict, sub-100 engaged, attributo non dichiarato; soprattutto su
// city ne mancano molti).
// `mappedTotal` opzionale: usato quando `data` è già una slice (es. top-N
// città) e vogliamo mostrare il vero totale del breakdown, non la somma
// dei soli visibili.
export function AudiencePanel({ icon, title, data, colors, labelMap, followersTotal, mappedTotal }) {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const sumVisible = sorted.reduce((s, r) => s + r.value, 0);
  const mapped = mappedTotal ?? sumVisible;
  const total = sumVisible || 1;
  const showRatio =
    followersTotal && mapped > 0 && mapped !== followersTotal;
  return (
    <div className="glass rounded-2xl p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 text-white/60 text-xs mono-font uppercase tracking-wider">
          {icon}
          <span>{title}</span>
        </div>
        {showRatio && (
          <span className="text-[10px] mono-font text-white/35">
            {mapped} / {followersTotal}
          </span>
        )}
      </div>
      <div className="space-y-3">
        {sorted.map((row) => {
          const pct = (row.value / total) * 100;
          const color = colors?.[row.key] || "#EDE5D0";
          const label = labelMap?.[row.key] || row.key;
          return (
            <div key={row.key}>
              <div className="flex justify-between text-[11px] mono-font mb-1">
                <span className="text-white/80">{label}</span>
                <span className="text-white/50">
                  {pct.toFixed(1)}% · {fmt(row.value)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: color,
                    opacity: 0.8,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
