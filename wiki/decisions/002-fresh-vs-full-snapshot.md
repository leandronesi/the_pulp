# ADR 002 — Split snapshot: daily full + fresh ogni 4h

**Data**: 2026-04-24
**Status**: accettata, implementata
**Aggiornata**: 2026-04-29 — cron fresh portato da ogni 4h a orario, esteso al daily_snapshot upsert. Vedi sezione "Aggiornamento 2026-04-29" sotto.

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

## Aggiornamento 2026-04-29

Tre cambi correlati nel sistema di snapshot, decisi guardando i numeri reali dell'account:

### 1. Cron fresh: da 4h a orario

Lo screenshot dei reel sull'app IG mostrava metriche aggiornate al minuto, mentre il dashboard aveva risoluzione 4h sui post freschi. Per un reel che cresce velocemente nelle prime ore (caso ricorrente di The Pulp), 4h è troppo grossolano per leggere il "moment of death" della curva.

Cambio: `5 */4 * * *` → `5 * * * *`. Da 6 a 24 run/giorno = ~168 punti/settimana per ogni reel fresco.

**Costi verificati**:
- Turso writes: ~10K/mese (vs limite 25M, **0,04%**)
- Meta API: ~9.400 call/mese su 200/h × 720h = ~144K (**6,5%**)
- GitHub Actions: repo public → minuti illimitati, gratis
- Storage post_snapshot: ~50KB extra/mese su 9GB

Numeri ben sotto qualunque limite. Free tier ovunque.

### 2. Cron orario scrive anche `daily_snapshot`

Prima il `daily_snapshot` era fotografato 1×/giorno a 22:00 UTC (mezzanotte Rome). Risultato: il deep report eseguito il pomeriggio lavorava su daily fermo a notte → il reach account-level del giorno in corso non era mai visibile fino al giorno dopo.

Ora il cron orario fa anche upsert su `daily_snapshot` del giorno in corso, range = mezzanotte Rome → ora corrente. Il valore cresce progressivamente nel corso della giornata e converge al definitivo quando il cron daily a 00:00 Rome lo finalizza.

Costo: +1 chiamata Meta `fetchDayTotals` + 1 write Turso per ogni run orario. Trascurabile.

### 3. Fix off-by-one su `daily_snapshot.date`

Bug strutturale scoperto guardando il `fetched_at`: il daily cron a 22:00 UTC = 00:00 Rome usava `todayIsoDate()` come label, ma il range fetchato era `(now-24h, now)` = la giornata appena chiusa (ieri). Risultato: la riga etichettata `2026-04-29` conteneva il reach di `2026-04-28`, off-by-one silenzioso.

Fix: il daily cron usa ora `yesterdayIsoDate()` (label = giorno coperto). Il cron orario usa `todayIsoDate()` (corretto: la riga del giorno in corso). Migrazione retroattiva one-shot in [scripts/db.js](../../ig-dashboard/scripts/db.js): `UPDATE daily_snapshot SET date = date(date, '-1 day')` shifta tutte le righe esistenti, segnando il flag `daily_date_offset_fix_v1` in tabella `meta` per non rieseguirla.

**Conseguenza per briefing/deep report**: la query "reach del 2026-04-26" prima leggeva i dati del 25, ora legge i dati del 26. I report storici già generati (in `reports/`) restano validi nei numeri ma con label sbagliata (off di 1 giorno).

### Quando riconsiderare ancora

- Se il free tier Turso/GitHub Actions cambia in negativo, ricontrollare i conti.
- Se IG aggiunge metriche da catturare a granularità sub-orario (es. live engagement), valutare cron a 30 min o webhook-based.
