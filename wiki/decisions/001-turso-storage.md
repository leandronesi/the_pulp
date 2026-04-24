# ADR 001 — Turso come archivio primario

**Data**: 2026-04-24
**Status**: accettata, implementata

## Contesto

Il dashboard iniziale era stateless — ricaricava tutto a ogni apertura dalla Graph API. Due limiti che bloccano ogni ambizione "analista":

1. La Graph API **non espone lo storico follower** né permette query retroattive oltre 30-90gg su molte metriche.
2. Non permette di vedere **come cresce un post nel tempo** (solo il valore corrente).

Serviva un layer persistente che catturasse snapshot e ne preservasse la storia.

## Opzioni considerate

| Opzione | Pro | Contro |
|---|---|---|
| **SQLite locale (`data/pulp.db`)** | Zero infra, zero account, `better-sqlite3` veloce | Dipende dal PC del dev acceso. Cron cloud non ci arriva |
| **Postgres su Supabase/Railway/Neon** | Scale, robusto | Overkill per volumi piccoli, più setup, più costi potenziali |
| **Turso (libsql managed)** | SQLite-compatibile, free tier generoso, OAuth GitHub, edge replicas gratis | Nuovo account, potenziale vendor lock-in (ma schema SQLite standard → migrazione facile) |
| **JSON blob su gist o S3** | Semplicissimo | Concorrenza scrittura fragile, niente query vere |

## Decisione

**Turso (libsql managed)**. Single SQLite file in cloud accessibile via HTTPS/WS.

Per mantenere l'ottica "zero lock-in": il codice usa `@libsql/client` che accetta sia URL remoti Turso (`libsql://...`) sia file locali (`file:data/pulp.db`). L'env var `TURSO_DATABASE_URL` decide quale target usare. Se assente → fallback locale.

**Risultato**: stesso codice, due modi di girare, zero duplicazione. Se un giorno dovessimo lasciare Turso, basta un `turso db shell pulp .dump > pulp.sql` e reimportiamo altrove.

## Conseguenze

**Positive:**
- Cron cloud (GitHub Actions) può scrivere senza che il mio PC sia acceso
- Lo schema è lo stesso sia in dev che in prod — niente "funziona in locale ma non in prod"
- Turso free tier (5GB storage, 1B rowsRead/mo) è enormemente sopra il nostro fabbisogno
- La skill `pulp-briefing` può query pulita via libsql sia in locale che da Claude Code remoto

**Negative accettate:**
- Nuova dipendenza esterna → punto di failure in più
- Latenza scrittura ~100ms/query vs microsecondi locale → risolto usando `db.batch()` per transazioni multi-statement (vedi [scripts/snapshot.js](../../ig-dashboard/scripts/snapshot.js))
- Richiede gestione auth token (rotabile, scadenza configurabile)

## Riferimenti

- [concepts/post-growth-curve.md](../concepts/post-growth-curve.md) — perché il layer persistente sblocca analisi della crescita
- [ig-dashboard/scripts/db.js](../../ig-dashboard/scripts/db.js) — schema autoritativo
- Turso docs: https://docs.turso.tech
