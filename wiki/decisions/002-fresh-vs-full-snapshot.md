# ADR 002 — Split snapshot: daily full + fresh ogni 4h

**Data**: 2026-04-24
**Status**: accettata, implementata

## Contesto

Catturare tutto ogni N ore produce rumore inutile. Un post di 6 mesi fa ha reach congelato — fotografarlo 6 volte al giorno è solo spreco di righe. Ma i post freschi (<7gg) crescono rapidamente e una cattura giornaliera è troppo rada per vedere la pendenza della curva nelle prime 24-48h.

## Opzioni considerate

| Opzione | Pro | Contro |
|---|---|---|
| **Sempre full ogni N ore** | Codice semplice, un cron | N righe inutili × post vecchi × 6 run/giorno = 5400+ righe/settimana di pura noia |
| **Sempre daily** | Minimo rumore | Perdi la risoluzione delle prime ore di vita di un post — il pezzo più interessante |
| **Split (scelto)** | Risoluzione fine sui post freschi, full una volta al giorno per storia completa | Due workflow, un po' più di coordinazione |
| **Smart diff (solo scrivi se cambiato)** | Pulito | Richiede query prima di scrivere → più call/più latenza. Rimandato |

## Decisione

**Due workflow GitHub Actions separati**:

1. **snapshot-daily.yml** — cron `0 22 * * *` (22:00 UTC)
   - Fetch completo: profilo, 5 totali periodo, 30 post + insights, 4 breakdown audience
   - Upsert su `daily_snapshot`, upsert su `post`, INSERT su `post_snapshot` (una riga per post), upsert su `audience_snapshot`

2. **snapshot-fresh.yml** — cron `5 */4 * * *` (ogni 4h, offset 5min)
   - Solo i post con `timestamp` negli ultimi 7gg (filtro in [scripts/snapshot.js](../../ig-dashboard/scripts/snapshot.js))
   - Upsert su `post`, INSERT su `post_snapshot`
   - Skippa profile, totals, audience

**Offset 5 min rispetto all'ora tonda** per non collidere con altre cron e per essere "diverso da tutti gli altri".

## Conseguenze

- **Un post pubblicato lunedì mattina** avrà: 6 snapshot/giorno × 7 giorni = ~42 punti sulla curva di crescita della prima settimana. Risoluzione più che sufficiente per misurare velocity e moment-of-death.
- **Un post di 2 settimane fa**: esce dal fresh filter, appare solo nel daily. 1 snapshot/giorno sufficiente per tracciare la coda lunga.
- **Righe DB**: ~30 post × 6 fresh run × 7gg + 30 post × 1 daily × 30gg = ~2000 righe/mese. Trascurabile per SQLite/Turso.
- **Costo rate-limit Graph API**: ~7 call/fresh run × 6/giorno + ~11 call/daily × 1/giorno = 53 call/giorno. Limit è 200/ora sul Page token → 24 min di runway. Siamo lontanissimi.

## Quando riconsiderare

- Se pubblichi >30 post/settimana: il filtro "ultimi 7gg" potrebbe escludere post ancora in crescita. Alzare `FRESH_WINDOW_DAYS` a 10-14 o implementare smart diff.
- Se la Graph API cambia rate limits: ricontrollare.

## Riferimenti

- [concepts/post-growth-curve.md](../concepts/post-growth-curve.md)
- [ig-dashboard/scripts/snapshot.js](../../ig-dashboard/scripts/snapshot.js) — flag `--fresh-only` + costante `FRESH_WINDOW_DAYS`
- [.github/workflows/snapshot-daily.yml](../../.github/workflows/snapshot-daily.yml), [.github/workflows/snapshot-fresh.yml](../../.github/workflows/snapshot-fresh.yml)
