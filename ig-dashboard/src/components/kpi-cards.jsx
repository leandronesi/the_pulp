import React from "react";
import { ResponsiveContainer, AreaChart, Area, YAxis } from "recharts";
import { InfoTip } from "./tooltips.jsx";
import { fmt } from "../utils/format.js";

// ---------------------------------------------------------------------------
// Sparkline — mini area chart. Usato qui da KpiCard, esportato perché PostCard
// (in posts.jsx) lo riusa.
//
// YAxis hide + domain ["dataMin", "dataMax"] padding e' fondamentale: di
// default Recharts <Area> usa baseValue=0, quindi su dati come follower
// (474..476 su baseline 0) la curva sta tutta in alto e sembra una linea
// piatta. Stretchando l'asse al range effettivo la variazione si vede.
// Padding ±1 evita che max/min tocchino i bordi.
// ---------------------------------------------------------------------------
export function Sparkline({ data, height = 28 }) {
  if (!data || data.length < 2) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#EDE5D0" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#EDE5D0" stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis
          hide
          domain={[
            (dataMin) => dataMin - Math.max(1, (dataMin || 0) * 0.005),
            (dataMax) => dataMax + Math.max(1, (dataMax || 0) * 0.005),
          ]}
        />
        <Area
          type="monotone"
          dataKey="reach"
          stroke="#EDE5D0"
          strokeWidth={1.5}
          fill="url(#sparkGrad)"
          isAnimationActive={false}
          baseValue="dataMin"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// DeltaPill — badge colorato con variazione percentuale vs periodo precedente.
// Dichiarato prima dei componenti che lo usano (RateCard, KpiCard, SummaryRow).
export function DeltaPill({ value }) {
  const flat = Math.abs(value) < 2;
  const up = value > 0;
  const color = flat
    ? "text-white/40 bg-white/5"
    : up
    ? "text-[#8FB5A3] bg-[#8FB5A3]/10"
    : "text-[#D98B6F] bg-[#D98B6F]/10";
  const arrow = flat ? "=" : up ? "↑" : "↓";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] mono-font ${color}`}
    >
      {arrow} {Math.abs(value).toFixed(1)}%{" "}
      <span className="text-white/30">vs prec.</span>
      <InfoTip
        text="Variazione rispetto al periodo precedente di pari durata. Se stai guardando 7g, confronto coi 7g precedenti; se 30g, coi 30g precedenti."
        side="top"
      />
    </span>
  );
}

// RateCard — tile compatto per la "rate strip" sotto l'hero.
// Pensato per metriche derivate (save rate, share rate, views totali, engaged).
// Meno imponente di KpiCard ma con tier pill visibile quando applicabile.
export function RateCard({ icon, label, value, tier, deltaPct, info }) {
  return (
    <div className="glass rounded-2xl p-4 sm:p-5 transition hover:border-white/15">
      <div className="flex items-center gap-2 text-white/55 text-[10px] mono-font mb-2 uppercase tracking-wider">
        {icon}
        <span className="truncate">{label}</span>
        {info && <InfoTip text={info} />}
      </div>
      <div className="display-font text-[1.75rem] sm:text-2xl text-white font-light tabular-nums break-words">
        {value}
      </div>
      {(tier || deltaPct != null) && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {deltaPct != null && <DeltaPill value={deltaPct} />}
          {tier && (
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] mono-font uppercase tracking-wider"
              style={{ backgroundColor: `${tier.color}15`, color: tier.color }}
            >
              {tier.label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ReachTrio — tre numeri sintetici accanto al titolo del reach chart:
// totale, media giornaliera, picco (con data). Dà densità informativa alla
// parte alta del panel che altrimenti è solo titolo + sottotitolo.
export function ReachTrio({ data }) {
  const total = data.reduce((s, d) => s + (d.reach || 0), 0);
  const avg = data.length ? total / data.length : 0;
  const peak = data.reduce(
    (m, d) => (d.reach > m.reach ? d : m),
    { reach: 0, date: "—" }
  );
  return (
    <div className="flex flex-wrap sm:flex-nowrap items-center gap-4 sm:gap-5 text-left sm:text-right">
      <div>
        <div className="text-[9px] mono-font uppercase tracking-wider text-white/40">
          totale
        </div>
        <div className="text-sm mono-font text-white font-semibold tabular-nums">
          {fmt(total)}
        </div>
      </div>
      <div>
        <div className="text-[9px] mono-font uppercase tracking-wider text-white/40">
          media/g
        </div>
        <div className="text-sm mono-font text-white font-semibold tabular-nums">
          {fmt(avg)}
        </div>
      </div>
      <div>
        <div className="text-[9px] mono-font uppercase tracking-wider text-white/40">
          picco · {peak.date}
        </div>
        <div className="text-sm mono-font text-[#EDE5D0] font-semibold tabular-nums">
          {fmt(peak.reach)}
        </div>
      </div>
    </div>
  );
}

export function KpiCard({ icon, label, value, accent, deltaPct, tier, tierLabel, sparkline, info }) {
  return (
    <div className="glass rounded-2xl p-4 sm:p-5 relative overflow-hidden group transition">
      <div
        className={`absolute -top-8 -right-8 w-24 h-24 rounded-full bg-gradient-to-br ${accent} opacity-20 blur-2xl group-hover:opacity-40 transition`}
      />
      <div className="flex items-center gap-2 text-white/60 text-xs mono-font mb-3">
        {icon}
        <span className="uppercase tracking-wider">{label}</span>
        {info && <InfoTip text={info} side="bottom" />}
      </div>
      <div className="display-font text-3xl sm:text-4xl text-white font-light break-words">{value}</div>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {deltaPct != null && <DeltaPill value={deltaPct} />}
        {tier && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] mono-font uppercase tracking-wider"
            style={{ backgroundColor: `${tier.color}15`, color: tier.color }}
          >
            {tierLabel ? `${tier.label} · ${tierLabel}` : `tier ${tier.label}`}
          </span>
        )}
      </div>
      {sparkline && sparkline.length >= 2 && (
        <div className="mt-3 -mx-1">
          <Sparkline data={sparkline} height={24} />
        </div>
      )}
    </div>
  );
}

export function SummaryRow({ icon, label, value, deltaPct, info, tier }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-b-0">
      <div className="flex items-center gap-2 text-white/60 text-xs mono-font">
        {icon}
        <span>{label}</span>
        {info && <InfoTip text={info} side="top" />}
      </div>
      <div className="text-right">
        <div className="text-white text-lg mono-font font-semibold">{value}</div>
        {deltaPct != null && (
          <div className="mt-0.5">
            <DeltaPill value={deltaPct} />
          </div>
        )}
        {tier && (
          <div className="mt-0.5">
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] mono-font uppercase tracking-wider"
              style={{ backgroundColor: `${tier.color}15`, color: tier.color }}
            >
              {tier.label}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function ContentMixStat({ label, info, value }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-white/50 uppercase text-[9px] tracking-wider">
        <span>{label}</span>
        <InfoTip text={info} side="top" />
      </div>
      <div className="text-white font-semibold">{value}</div>
    </div>
  );
}
