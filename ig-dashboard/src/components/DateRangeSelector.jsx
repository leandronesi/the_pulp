import { useState, useEffect } from "react";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker } from "react-day-picker";
import { it } from "date-fns/locale";
import "react-day-picker/dist/style.css";
import { Calendar } from "lucide-react";

export function DateRangeSelector({
  selection,
  isCustom,
  customOpen,
  setCustomOpen,
  onPreset,
  onCustom,
  days,
  sinceUnix,
  untilUnix,
}) {
  const [draftRange, setDraftRange] = useState(() => ({
    from: new Date(sinceUnix * 1000),
    to: new Date(untilUnix * 1000),
  }));

  useEffect(() => {
    if (customOpen) {
      setDraftRange({
        from: new Date(sinceUnix * 1000),
        to: new Date(untilUnix * 1000),
      });
    }
  }, [customOpen, sinceUnix, untilUnix]);

  const applyCustom = () => {
    if (draftRange?.from && draftRange?.to && draftRange.from < draftRange.to) {
      const t = new Date(draftRange.to);
      t.setHours(23, 59, 59, 0);
      onCustom(draftRange.from, t);
      setCustomOpen(false);
    }
  };

  const customLabel = isCustom
    ? `${new Date(sinceUnix * 1000).toLocaleDateString("it-IT", {
        day: "2-digit",
        month: "short",
      })} → ${new Date(untilUnix * 1000).toLocaleDateString("it-IT", {
        day: "2-digit",
        month: "short",
      })}`
    : "custom";

  const draftDays =
    draftRange?.from && draftRange?.to
      ? Math.max(
          1,
          Math.round(
            (draftRange.to.getTime() - draftRange.from.getTime()) / 86400000
          )
        )
      : 0;

  return (
    <div className="glass rounded-3xl sm:rounded-full px-2 py-1 flex flex-wrap sm:flex-nowrap items-center gap-1 w-full sm:w-auto">
      {/* "tot" = tutta la memoria disponibile (dal restart o primo daily
          a oggi). È il default. Poi 7d e 30d come preset numerici, poi
          custom. Niente 90d preset (era chunking-gonfio prima del
          refactor "solo daily_snapshot"). */}
      <button
        onClick={() => onPreset("tot")}
        className={`px-3 py-1.5 text-xs rounded-full transition mono-font whitespace-nowrap ${
          !isCustom && selection.preset === "tot"
            ? "bg-[#EDE5D0] text-[#0B3A30] font-semibold"
            : "text-white/60 hover:text-white"
        }`}
      >
        tot
      </button>
      {[7, 30].map((d) => {
        const active = !isCustom && selection.preset === d;
        return (
          <button
            key={d}
            onClick={() => onPreset(d)}
            className={`px-3 py-1.5 text-xs rounded-full transition mono-font whitespace-nowrap ${
              active
                ? "bg-[#EDE5D0] text-[#0B3A30] font-semibold"
                : "text-white/60 hover:text-white"
            }`}
          >
            {d}d
          </button>
        );
      })}
      <Popover.Root open={customOpen} onOpenChange={setCustomOpen}>
        <Popover.Trigger asChild>
          <button
            className={`px-3 py-1.5 text-xs rounded-full transition mono-font flex items-center gap-1.5 whitespace-nowrap max-w-full ${
              isCustom
                ? "bg-[#EDE5D0] text-[#0B3A30] font-semibold"
                : "text-white/60 hover:text-white"
            }`}
          >
            <Calendar size={11} />
            <span className="truncate">{customLabel}</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            sideOffset={10}
            align="end"
            collisionPadding={16}
            className="z-[100] rounded-3xl p-4 sm:p-5 shadow-2xl pulp-calendar w-[min(calc(100vw-2rem),22rem)] sm:w-auto"
            style={{
              background:
                "linear-gradient(180deg, rgba(22,79,63,0.98) 0%, rgba(11,58,48,0.98) 100%)",
              border: "1px solid rgba(237,229,208,0.15)",
              backdropFilter: "blur(24px)",
            }}
          >
            <div className="flex items-baseline justify-between mb-4">
              <div>
                <div className="display-font text-xl text-white italic">
                  scegli un periodo
                </div>
                <div className="text-[10px] mono-font text-white/50 mt-1">
                  clicca due date per definire il range
                </div>
              </div>
              {draftDays > 0 && (
                <div className="text-[11px] mono-font text-[#EDE5D0]">
                  {draftDays} {draftDays === 1 ? "giorno" : "giorni"}
                </div>
              )}
            </div>

            <DayPicker
              mode="range"
              selected={draftRange}
              onSelect={setDraftRange}
              numberOfMonths={1}
              locale={it}
              weekStartsOn={1}
              disabled={{ after: new Date() }}
              showOutsideDays
            />

            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-white/5">
              <button
                onClick={() => setCustomOpen(false)}
                className="text-white/50 hover:text-white text-xs mono-font transition"
              >
                annulla
              </button>
              <div className="flex-1" />
              <button
                onClick={applyCustom}
                disabled={
                  !(
                    draftRange?.from &&
                    draftRange?.to &&
                    draftRange.from < draftRange.to
                  )
                }
                className="bg-[#EDE5D0] text-[#0B3A30] rounded-full px-4 py-1.5 text-xs font-semibold mono-font hover:bg-white transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                applica
              </button>
            </div>
            <Popover.Arrow className="fill-[#0B3A30]" width={14} height={7} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
