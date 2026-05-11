import * as RTooltip from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";
import { fmt, fmtDate, fmtDuration } from "../utils/format.js";
import { POST_DOT_COLORS, POST_DOT_LABELS } from "../utils/tiers.js";
import { resolveMediaType } from "../analytics.js";
import { REEL_WATCH_QUADRANT_META } from "../analytics.js";

// ─── Subcomponents ──────────────────────────────────────────────────────────
// InfoTip — wrapper su @radix-ui/react-tooltip.
// Radix usa Floating UI internamente → collision detection, auto-flip,
// portal automatico fuori da overflow:hidden, ARIA accessibile, supporto
// keyboard. Un ordine di grandezza meglio del nostro custom.
export function InfoTip({ text, side = "top" }) {
  return (
    <RTooltip.Root delayDuration={150}>
      <RTooltip.Trigger asChild>
        <span
          className="inline-flex items-center cursor-help ml-1"
          onClick={(e) => {
            // su touch il tap attiva anche il parent; fermiamo qui
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <Info
            size={10}
            className="text-white/40 hover:text-white/90 transition"
          />
        </span>
      </RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-[9999] w-60 glass rounded-lg p-2 text-[10px] mono-font text-white/85 leading-relaxed normal-case tracking-normal shadow-2xl data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in"
        >
          {text}
          <RTooltip.Arrow className="fill-white/10" />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export function DarkTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="glass rounded-xl px-4 py-3 text-xs"
      style={{ fontFamily: "JetBrains Mono" }}
    >
      <div className="text-white/50 mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-white">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: p.color || p.fill }}
          />
          <span className="text-white/70">{p.name || p.dataKey}:</span>
          <span className="font-semibold">
            {typeof p.value === "number" && p.value < 100
              ? p.value.toFixed(1)
              : fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// Tooltip del chart Reach giornaliero: mostra reach del giorno + lista
// dei post pubblicati quel giorno (label tipo + caption breve, colore-coded).
export function ReachWithPostsTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const reachItem = payload.find((p) => p.dataKey === "reach");
  const reach = reachItem?.value;
  const dayPosts = payload[0]?.payload?._posts || [];
  return (
    <div
      className="glass rounded-xl px-4 py-3 text-xs max-w-xs"
      style={{ fontFamily: "JetBrains Mono" }}
    >
      <div className="text-white/50 mb-1">{label}</div>
      {reach != null && (
        <div className="flex items-center gap-2 text-white mb-1">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: "#EDE5D0" }}
          />
          <span className="text-white/70">reach:</span>
          <span className="font-semibold">{fmt(reach)}</span>
        </div>
      )}
      {dayPosts.length > 0 && (
        <div className="mt-2 pt-2 border-t border-white/10 space-y-1.5">
          {dayPosts.map((p) => {
            const t = resolveMediaType(p);
            const key = POST_DOT_COLORS[t] ? t : "IMAGE";
            const caption = (p.caption || "").slice(0, 80);
            return (
              <div key={p.id} className="flex gap-2">
                <div
                  className="w-2 h-2 mt-1 rounded-full shrink-0"
                  style={{ backgroundColor: POST_DOT_COLORS[key] }}
                />
                <div className="text-white/80 leading-snug">
                  <span className="text-white/50">
                    {POST_DOT_LABELS[key]}
                  </span>
                  {caption && (
                    <span className="text-white/70"> · {caption}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ScatterTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const dateValid = d.date && !Number.isNaN(new Date(d.date).getTime());
  return (
    <div
      className="glass rounded-xl p-3 text-xs max-w-xs"
      style={{ fontFamily: "JetBrains Mono" }}
    >
      {d.thumb && (
        <img
          src={d.thumb}
          alt=""
          className="w-full h-32 object-cover rounded-lg mb-2"
          loading="lazy"
        />
      )}
      {dateValid && (
        <div className="text-white/50 text-[10px] mb-1">{fmtDate(d.date)}</div>
      )}
      {d.caption && (
        <p className="text-white/80 text-[11px] mb-2 line-clamp-2">
          {d.caption.slice(0, 80)}
          {d.caption.length > 80 ? "…" : ""}
        </p>
      )}
      <div className="grid grid-cols-2 gap-1 text-[10px]">
        <div>
          <span className="text-white/50">reach</span>
          <span className="text-white font-semibold ml-1">{fmt(d.x)}</span>
        </div>
        <div>
          <span className="text-white/50">ER</span>
          <span className="text-white font-semibold ml-1">
            {d.y != null ? `${d.y.toFixed(1)}%` : "—"}
          </span>
        </div>
        <div>
          <span className="text-white/50">reach/g</span>
          <span className="text-white font-semibold ml-1">
            {d.velocity7d != null ? `${fmt(d.velocity7d)}/g` : "—"}
          </span>
        </div>
        {d.quadrant && (
          <div className="col-span-2">
            <span className="text-white/50">quadrant</span>
            <span className="text-white font-semibold ml-1">{d.quadrant}</span>
            {d.outlierFlag && (
              <span className="ml-2 text-[#EDE5D0] uppercase">outlier</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Tooltip dedicato allo scatter Reel: x=views, y=watch medio per view (s).
// Mostra anche il tempo totale di visualizzazione del reel, che è la
// "scala" del punto (= view × watch).
export function ReelWatchTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const dateValid = d.date && !Number.isNaN(new Date(d.date).getTime());
  const qm = d.quadrant ? REEL_WATCH_QUADRANT_META[d.quadrant] : null;
  return (
    <div
      className="glass rounded-xl p-3 text-xs max-w-xs"
      style={{ fontFamily: "JetBrains Mono" }}
    >
      {d.thumb && (
        <img
          src={d.thumb}
          alt=""
          className="w-full h-32 object-cover rounded-lg mb-2"
          loading="lazy"
        />
      )}
      {dateValid && (
        <div className="text-white/50 text-[10px] mb-1">{fmtDate(d.date)}</div>
      )}
      {d.caption && (
        <p className="text-white/80 text-[11px] mb-2 line-clamp-2">
          {d.caption.slice(0, 80)}
          {d.caption.length > 80 ? "…" : ""}
        </p>
      )}
      <div className="grid grid-cols-2 gap-1 text-[10px]">
        <div>
          <span className="text-white/50">views</span>
          <span className="text-white font-semibold ml-1">{fmt(d.x)}</span>
        </div>
        <div>
          <span className="text-white/50">watch</span>
          <span className="text-white font-semibold ml-1">
            {d.y != null ? `${d.y.toFixed(d.y >= 10 ? 0 : 1)}s` : "—"}
          </span>
        </div>
        <div className="col-span-2">
          <span className="text-white/50">tempo totale</span>
          <span className="text-white font-semibold ml-1">
            {d.totalWatchMs != null ? fmtDuration(d.totalWatchMs) : "—"}
          </span>
        </div>
        {qm && (
          <div className="col-span-2">
            <span className="text-white/50">quadrant</span>
            <span className="text-white font-semibold ml-1">{qm.label}</span>
            {d.outlierFlag && (
              <span className="ml-2 text-[#EDE5D0] uppercase">outlier</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
