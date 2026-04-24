# Audit — Audience The Pulp · 2026-04-24

Prima fotografia strutturata dell'account, immediatamente dopo la migrazione a Turso. Fonte: `SELECT ... FROM audience_snapshot WHERE date = '2026-04-24'` + `SELECT ... FROM daily_snapshot WHERE date = '2026-04-24'`.

## Vitals

- **Followers**: 474
- **Seguiti**: 82
- **Media count storico**: 86
- **Reach giornata (24/4)**: 71
- **Interazioni giornata**: 3
- **Account engaged giornata**: 3

## Audience — genere

| Key | Value | % |
|---|---|---|
| F | 274 | 58% |
| M | 127 | 27% |
| U (non specificato) | 70 | 15% |

## Audience — età (fascia maggiori valori)

Distribuzione tipica a campana con picco 25-34. Dettaglio esatto in `audience_snapshot WHERE breakdown='age'`.

## Audience — geografia (top 5 città)

| Rank | Città | Followers |
|---|---|---|
| 1 | Rome, Lazio | 233 |
| 2 | Viterbo, Lazio | 18 |
| 3 | Acilia, Lazio | 8 |
| 4 | Casale Prima Porta, Lazio | 7 |
| 5 | Milan, Lombardia | 7 |

**Totale city categorizzati**: 351 su 474 (74% geo-noti).
**Roma + satelliti Lazio nei primi 4**: ~266 → ~75% dei geo-categorizzati.

## Osservazioni

1. **Pulp è Roma-centric, non nazionale**. Su 351 follower geolocalizzati, 233 sono a Roma (66%) e i top 4 città sono tutti Lazio. Milano quinta con 7 (2%). **Implicazione per i briefing**: mai trattare The Pulp come account generalista italiano; i benchmark di settore "medi" non si applicano senza contesto geografico.

2. **Audience femminile dominante (58%)**: in linea col tono narrativo-editoriale del brand. Evitare assunzioni che i contenuti "tecnico-enologici hard" vadano bene → il pubblico sembra più orientato alla dimensione narrativa/culturale del vino.

3. **15% "Unspecified" per gender**: sostanziale ma non drammatico. Meta tagga così i profili che non hanno dichiarato genere esplicitamente.

4. **Seguiti solo 82** — ratio follower/seguiti = 5.8. Account ben curato in termini di discipline (non segue tutti per reciprocità).

## Implicazioni per il prossimo briefing

Quando produciamo il primo briefing settimanale:
- Quando parliamo di reach assoluto (70-2000 per post), **non** è un numero basso in senso assoluto per un account da 474: è normale. I tier IG vanno applicati ai **rapporti** (ER, reach/follower), non ai valori nudi.
- L'audience romana suggerisce che **contenuti location-specific Roma/Lazio** dovrebbero performare meglio della media. Verificare con cross-reference tra `caption` dei post e reach.
- Il dato "15% U" va menzionato nel primo briefing così l'utente sa che il gender split F/M è su ~460, non 474.

## Da ri-auditare

- **Shift audience nel tempo**: questa è la baseline. Tra 30gg, rifare lo stesso query e vedere se la distribuzione gender/geo è cambiata. Se vedete spike di Milano → significa che un contenuto ha rotto la bolla Lazio.
- **Età più dettagliata**: il breakdown `age` va confrontato con età engaged (tramite `engaged_audience_demographics` se accessibile via Graph API).

## Riferimenti

- Query usate:
  ```sql
  SELECT date, followers_count, reach, accounts_engaged, total_interactions
  FROM daily_snapshot WHERE date = '2026-04-24';

  SELECT key, value FROM audience_snapshot
  WHERE date = '2026-04-24' AND breakdown = 'gender'
  ORDER BY value DESC;

  SELECT key, value FROM audience_snapshot
  WHERE date = '2026-04-24' AND breakdown = 'city'
  ORDER BY value DESC LIMIT 5;
  ```
- [.claude/skills/pulp-briefing/references/brand-context.md](../../.claude/skills/pulp-briefing/references/brand-context.md) — incorpora questi dati come baseline
