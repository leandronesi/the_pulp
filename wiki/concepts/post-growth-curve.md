# Concept — Curva di crescita di un post

## Perché è importante

La Graph API dà solo il valore **corrente** delle metriche di un post. Chiedi ora → hai un numero. Chiedi tra un'ora → un numero diverso. Ma non c'è un endpoint che ti restituisca "l'andamento nel tempo": quello va costruito salvandosi gli snapshot ogni N ore.

Avere la curva di crescita sblocca:

- **Velocity iniziale**: quanti reach/ora nelle prime 24-48h. Discrimina "post che esplode subito" vs "post che sale piano".
- **Moment of death**: quando Δreach → 0 per N giorni consecutivi. Il post ha finito di correre. Orizzonte utile per il planning editoriale.
- **Late virality detection**: post vecchio >7gg che improvvisamente riprende a crescere. Segnale forte (qualcuno l'ha rilanciato, l'algo ha dato un push).
- **Comparazione pulita tra post**: "il reel A ha fatto 500 reach in 2h, il carosello B in 8h". Prima era impossibile.

## Come lo registriamo

Schema autoritativo [scripts/db.js](../../ig-dashboard/scripts/db.js):

```sql
CREATE TABLE post_snapshot (
  post_id TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  like_count INTEGER,
  comments_count INTEGER,
  reach INTEGER,
  saved INTEGER,
  shares INTEGER,
  views INTEGER,
  PRIMARY KEY (post_id, fetched_at)
);
```

**Chiave chiave chiave**: la PK è `(post_id, fetched_at)`. Ogni volta che lo script `snapshot` (o `snapshot:fresh`) gira, inserisce **una riga nuova** per ogni post. Nessun overwrite. La tabella cresce.

## Esempio

Un post pubblicato lunedì alle 10:00. Il fresh snapshot parte ogni 4h a 00:05, 04:05, ecc. Il suo profilo nella tabella, a fine settimana:

```
post_id         | fetched_at (ms) | reach | like_count | saved
XXX             | 1779100000000   |     8 |          2 |     0  <- lun 10:05, 5 min post publish
XXX             | 1779114400000   |   120 |         11 |     2  <- lun 14:05
XXX             | 1779128800000   |   280 |         21 |     5  <- lun 18:05
...
XXX             | 1779705200000   |  1840 |         68 |    11  <- dom 18:05
```

Per ottenere la curva: `SELECT fetched_at, reach FROM post_snapshot WHERE post_id = 'XXX' ORDER BY fetched_at`.

## Limiti da tenere a mente

- **Solo ultimi 30 post**: ogni snapshot fa `GET /media?limit=30`. Quando pubblichi il 31° post nuovo, il più vecchio esce dalla finestra e smette di ricevere snapshot. La curva si congela all'ultimo valore.
  - Per The Pulp con `media_count=86` e ritmo ~2-3 post/settimana: un post resta in finestra per 10-15 settimane. Sopra ogni analisi utile.
  - Se serve tracciare anche post fuori finestra: paginare `/media` via cursor.
- **Risoluzione = frequenza snapshot**: con il setup attuale (fresh ogni 4h per 7gg, poi daily), un post fresco ha ~42 punti nella prima settimana, poi 1/giorno.
- **Graph API delta vs reality**: Meta riaggiorna i contatori con un po' di lag (qualche minuto a qualche ora). Non cercare precisione sub-oraria.

## Query tipiche

### Delta reach tra due snapshot consecutivi
```sql
SELECT post_id,
       reach AS reach_now,
       LAG(reach) OVER (PARTITION BY post_id ORDER BY fetched_at) AS reach_prev,
       reach - LAG(reach) OVER (PARTITION BY post_id ORDER BY fetched_at) AS delta
FROM post_snapshot
WHERE post_id = ?;
```

### Velocity nelle prime 24h
```sql
SELECT MAX(reach) - MIN(reach) AS reach_24h
FROM post_snapshot
WHERE post_id = ?
  AND fetched_at BETWEEN ? AND ? + 86400000;
```

### Post in "late virality" (reach fermo per 7gg, poi riprende)
Da implementare nella skill `pulp-briefing`. Pattern: confronto delta ultimi 7gg vs delta 7-14gg fa.

## Riferimenti

- [decisions/002-fresh-vs-full-snapshot.md](../decisions/002-fresh-vs-full-snapshot.md) — come/perché lo split snapshot serve la curva
- [concepts/reach-deduplication.md](reach-deduplication.md) — cosa significa esattamente il numero "reach" che stiamo salvando
