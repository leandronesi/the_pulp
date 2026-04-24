# Concept — Reach deduplication: perché la somma non torna

## Il fatto contro-intuitivo

Se chiedi alla Graph API il reach di oggi, di ieri, e dell'altroieri, e li sommi, **non ottieni** il reach degli ultimi 3 giorni come valore unico.

```
GET /insights?metric=reach&period=day&since=2d_ago&until=today
  → values: [ {reach: 500}, {reach: 600}, {reach: 700} ]
  → SUM = 1800

GET /insights?metric=reach&metric_type=total_value&period=day&since=2d_ago&until=today
  → total_value.value = 1200
```

`1200 ≠ 1800`. E la differenza non è un bug.

## Perché

**Reach è "utenti unici"**. Nel calcolo `period=day`, Meta deduplica **dentro la giornata**: se @mario vede 5 tuoi post oggi, conta come 1 per oggi.

Nella somma manuale dei 3 giorni:
- Giorno 1: @mario ha visto → conta 1
- Giorno 2: @mario ha visto di nuovo → conta 1
- Giorno 3: @mario ha visto di nuovo → conta 1
- SUM: 3 (stesso utente contato 3 volte)

Nel `total_value` sul range di 3 giorni, Meta deduplica **cross-day**: @mario è uno, indipendentemente da quanti giorni è passato → conta 1.

Quindi `total_value` su range ≤ somma dei giornalieri, sempre. L'ampiezza della differenza dice "quanto i tuoi visitatori tornano".

## Implicazioni per il dashboard

- **Reach chart giornaliero** (`reachDaily`): bar/area chart con i valori per giorno. **Legge la forma, non il totale**. Non sommare mai per ottenere il totale del periodo.
- **Reach totale del periodo** (mostrato nell'hero card): usa `total_value` sul range completo. Già deduplicato.
- Nel briefing: dire "reach periodo: X" usando `total_value`, non sommando i giorni.

## Implicazioni per i briefing

- **Week-over-week comparison**: sempre usando `total_value` settimanale vs `total_value` settimana scorsa. Stesso metodo di calcolo, comparabile.
- **Non mescolare mai scale**: se citi il reach di un singolo giorno ("lunedì sono stato a 700 reach") non sommarlo al "reach periodo 30gg" per stilare narrativa.

## Cosa salva Turso

`daily_snapshot.reach` è il reach del SINGOLO giorno (period=day con since/until di 1 giorno — vedi [scripts/snapshot.js](../../ig-dashboard/scripts/snapshot.js) funzione `fetchDayTotals`). Quindi anche nel DB il valore è "reach del giorno", non cumulativo. Per ottenere il reach-totale-periodo correttamente: re-interrogare la Graph API con range completo, non sommare righe di `daily_snapshot`.

**Trade-off**: potremmo anche salvare il `reach_30d_total_value` cadauno snapshot, ma diventerebbe ridondante e si disallineerebbe. Meglio: se il briefing ha bisogno del `total_value` di un range specifico, fa una call Graph API dedicata (è una sola call).

## Riferimenti

- [concepts/engagement-rate.md](engagement-rate.md) — ER usa il reach al denominatore, quindi eredita questa semantica
- Meta docs Insights: https://developers.facebook.com/docs/instagram-api/guides/insights
