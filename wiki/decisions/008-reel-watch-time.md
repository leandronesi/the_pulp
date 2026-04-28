# ADR 008 — Watch time per i reel: schema asimmetrico su `post_snapshot`

**Data**: 2026-04-28
**Status**: accettata, implementata

## Contesto

Lo screenshot da Insights IG mostra che per ogni reel l'app ufficiale espone due metriche che noi non stiamo capturando:

- **Tempo di visualizzazione** (`ig_reels_video_view_total_time`) — somma totale del tempo speso a guardare il reel, in millisecondi.
- **Tempo di visualizzazione medio** (`ig_reels_avg_watch_time`) — media per impression, in ms.

Sono tra i segnali più predittivi di "il reel funziona davvero o passa solo nel feed". Oggi giudichiamo i reel come gli altri post — solo via `reach + ER + saved + shares + views`. `views` da solo è cieco: 1000 views da 1s vs 1000 views da 30s sono mondi diversi.

## Vincolo tecnico

`ig_reels_*` sono **REEL-only**. Se vengono inseriti nel batch `insights.metric(...)` embedded di `/{ig}/media`, l'intera richiesta fallisce per ogni post non-reel del batch — e perdiamo gli insights di tutti i carousel/image. Quindi non si possono fare insieme.

## Opzioni considerate

| Opzione | Pro | Contro |
|---|---|---|
| **Schema separato (`reel_snapshot`)** | Pulito, schema simmetrico per ogni tabella | Doppia query ovunque; per il dashboard significa una JOIN aggiuntiva su ogni render |
| **Colonna JSON** (`reel_metrics_json`) | 1 sola colonna, espandibile | Indicizzabilità zero, query più scomode, niente type-safety SQL |
| **Colonne nullable su `post_snapshot` (scelto)** | Una sola tabella; SELECT esistenti continuano a funzionare; query semplici | Asimmetria: NULL su image/carousel. Accettabile — IG ha già questa asimmetria nei suoi insights |

## Decisione

Due colonne nullable su `post_snapshot`:

```sql
video_view_total_time INTEGER  -- ms, NULL per non-reel
avg_watch_time INTEGER         -- ms, NULL per non-reel
```

**Migration**: `ALTER TABLE ADD COLUMN` in try/catch (idempotente per DB pre-esistenti, stesso pattern di `story_snapshot.navigation`).

**Fetch dedicato per reel** in [ig-fetch.js](../../ig-dashboard/scripts/ig-fetch.js): `fetchReelInsights(gql, mediaId)` chiama `/{media_id}/insights?metric=ig_reels_video_view_total_time,ig_reels_avg_watch_time`. Errori graceful → null.

**Wiring in [snapshot.js](../../ig-dashboard/scripts/snapshot.js)**: dopo il filtro `toWrite`, identifica i post con `media_product_type === "REELS"` e per ognuno chiama `fetchReelInsights` (concurrency 8, stesso pattern delle stories). I valori finiscono nelle 2 nuove colonne; non-reel scrivono NULL.

**Costo**: 1 chiamata API extra per reel pubblicato negli ultimi 7gg, sia in fresh sia in full. Sull'account The Pulp (~3-5 reel/settimana) sono <30 call/giorno aggiuntive — irrilevante rispetto al limite di 200/ora.

## Conseguenze

- **`post_snapshot` ha 2 colonne `NULL` per i post non-reel.** Asimmetria documentata nello schema con commento.
- **Curva di crescita del watch time** disponibile come per le altre metriche: ogni snapshot fresh aggiunge un punto, dopo 1 settimana abbiamo ~42 punti per reel.
- **Deep report e dashboard** possono ora considerare `avg_watch_time` come segnale di qualità del reel (oggi indecisi su dove esattamente displayare — la metrica sta dietro le quinte).
- **`postHistory` nel `data.json` statico** include ora i due campi (`video_view_total_time`, `avg_watch_time`) per ogni snapshot del reel.

## Conversioni

I valori arrivano in millisecondi. Per UI: `format(ms / 1000)` come secondi, oppure `4h 29m 42s` per il totale lifetime quando alto. Non normalizzare a secondi all'inserimento: meglio mantenere la fedeltà del dato originale.

## Quando riconsiderare

- Se IG aggiunge altre metriche reel-only (es. `ig_reels_completion_rate`): valuta se vale schema separato `reel_snapshot` per evitare colonne sempre più nullable.
- Se aggiungiamo metriche format-specifiche per altri tipi (es. `ig_carousel_*`): a 4+ colonne null per tipo, lo schema asimmetrico inizia a puzzare → spin-off in tabelle dedicate.

## Riferimenti

- [Meta API — Instagram Reels Insights](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-media/insights) (metriche `ig_reels_*`)
- [ig-dashboard/scripts/db.js](../../ig-dashboard/scripts/db.js) — schema + ALTER migration
- [ig-dashboard/scripts/ig-fetch.js](../../ig-dashboard/scripts/ig-fetch.js) — `fetchReelInsights`
- [ig-dashboard/scripts/snapshot.js](../../ig-dashboard/scripts/snapshot.js) — wiring in `writePosts`
- ADR [002-fresh-vs-full-snapshot](002-fresh-vs-full-snapshot.md) — costo della chiamata extra è dentro il budget rate-limit
