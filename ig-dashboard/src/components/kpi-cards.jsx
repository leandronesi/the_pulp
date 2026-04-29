import React from "react";
import { ResponsiveContainer, AreaChart, Area, YAxis, Tooltip } from "recharts";
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
//
// Prop interactive (opt-in): mostra dot ai punti di variazione + tooltip
// su hover (data + valore). Richiede che ogni punto abbia un campo `date`.
// ---------------------------------------------------------------------------

function SparkTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div
      className="glass rounded-md px-2 py-1 text-[10px] mono-font text-white/85"
      style={{ fontFamily: "JetBrains Mono" }}
    >
      <span className="text-white/50">{p.date || "—"}</span>
      <span className="ml-2 font-semibold">{fmt(p.reach)}</span>
    </div>
  );
}

export function Sparkline({ data, height = 28, interactive = false }) {
  if (!data || data.length < 2) return null;

  // Dot custom: renderizzato solo dove il valore cambia rispetto al
  // precedente (e sempre sull'ultimo punto, cosi' "ora" si vede).
  const renderDot = (props) => {
    const { cx, cy, index } = props;
    if (cx == null || cy == null) return null;
    const cur = data[index]?.reach;
    const prev = data[index - 1]?.reach;
    const isLast = index === data.length - 1;
    const changed = prev !== undefined && prev !== cur;
    if (!changed && !isLast) return null;
    return (
      <circle
        key={`spark-dot-${index}`}
        cx={cx}
        cy={cy}
        r={2.5}
        fill="#EDE5D0"
        stroke="#0B3A30"
        strokeWidth={1}
      />
    );
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 2, left: 4 }}>
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
        {interactive && (
          <Tooltip
            content={<SparkTooltip />}
            cursor={{ stroke: "#EDE5D0", strokeOpacity: 0.2, strokeDasharray: "2 2" }}
          />
        )}
        <Area
          type="monotone"
          dataKey="reach"
          stroke="#EDE5D0"
          strokeWidth={1.5}
          fill="url(#sparkGrad)"
          isAnimationActive={false}
          baseValue="dataMin"
          dot={interactive ? renderDot : false}
          activeDot={interactive ? { r: 3.5, fill: "#EDE5D0", stroke: "#0B3A30", strokeWidth: 1 } : false}
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
// Pensato per metriche derivate (save rate, share rate, reach, engagement).
// Meno imponente di KpiCard ma con tier pill visibile quando applicabile.
// tierLabel: testo opzionale aggiunto alla pill dopo il tier.label (es. "30% dei follower").
// legend: array opzionale di { label, color, range } per la stripe cluster IG.
// legendCurrent: label del tier attivo nella legend (per evidenziarlo).
// RateCard accetta legend perché solo Engagement ha la stripe cluster —
// non era worth una astrazione separata.
export function RateCard({ icon, label, value, tier, tierLabel, deltaPct, info, legend, legendCurrent }) {
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
              {tierLabel ? `${tier.label} · ${tierLabel}` : tier.label}
            </span>
          )}
        </div>
      )}
      {legend && legend.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {legend.map((t) => {
            const isCurrent = t.label === legendCurrent;
            return (
              <span
                key={t.label}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                style={{
                  backgroundColor: isCurrent ? `${t.color}20` : `${t.color}10`,
                  color: t.color,
                  border: isCurrent ? `1px solid ${t.color}50` : "1px solid transparent",
                  fontSize: "9px",
                  fontFamily: "JetBrains Mono",
                  textTransform: isCurrent ? "uppercase" : "none",
                  letterSpacing: "0.05em",
                }}
              >
                {t.label}
                <span style={{ opacity: 0.6, fontFamily: "JetBrains Mono" }}>{t.range}</span>
              </span>
            );
          })}
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

export function KpiCard({ icon, label, value, accent, deltaPct, tier, tierLabel, sparkline, info, legend, legendCurrent, subtitle }) {
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
      {subtitle && (
        <div className="mt-1 text-[10px] mono-font text-white/45 tabular-nums">
          {subtitle}
        </div>
      )}
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
      {legend && legend.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {legend.map((t) => {
            const isCurrent = t.label === legendCurrent;
            return (
              <span
                key={t.label}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                style={{
                  backgroundColor: isCurrent ? `${t.color}20` : `${t.color}10`,
                  color: t.color,
                  border: isCurrent ? `1px solid ${t.color}50` : "1px solid transparent",
                  fontSize: "9px",
                  fontFamily: "JetBrains Mono",
                  textTransform: isCurrent ? "uppercase" : "none",
                  letterSpacing: "0.05em",
                }}
              >
                {t.label}
                <span style={{ opacity: 0.6, fontFamily: "JetBrains Mono" }}>{t.range}</span>
              </span>
            );
          })}
        </div>
      )}
      {sparkline && sparkline.length >= 2 && (
        <div className="mt-3 -mx-1">
          <Sparkline data={sparkline} height={28} interactive />
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
