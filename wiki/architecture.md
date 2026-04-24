# Architettura — The Pulp

Tre layer indipendenti, uniti dai dati Instagram di **@_the_pulp** (IG Business, Page FB `111507393712812`).

```
┌─────────────────────────────────────────────────────────────────────┐
│                         INSTAGRAM GRAPH API                         │
│                       (fonte di verità esterna)                     │
└───────────┬───────────────┬───────────────┬─────────────────────────┘
            │               │               │
   Page access token     Stesso            Stesso
   (non-expiring)        token             token
            │               │               │
            ▼               ▼               ▼
   ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐
   │  Dashboard  │  │   Snapshot   │  │  Export JSON    │
   │  client-side│  │   scripts    │  │  (pre-render    │
   │   (live)    │  │  (to Turso)  │  │  per GH Pages)  │
   └──────┬──────┘  └──────┬───────┘  └────────┬────────┘
          │                │                    │
          │        ┌───────▼───────┐            │
          │        │  TURSO  libsql│            │
          │        │   pulp.db     │            │
          │        └───────────────┘            │
          │                │                    │
          │                └────────────┐       │
          │         (analista legge)    │       │
          │                             ▼       ▼
          │                   ┌──────────────────────┐
          │                   │  Briefing / analisi  │
          │                   │  (skill pulp-briefing│
          │                   │   + Claude Opus)     │
          │                   └──────────────────────┘
          │
          ▼
   localhost:5180              https://leandronesi.github.io/the_pulp/
   (dev, token nel bundle)    (deploy pubblico, token server-side only)
```

## Layer 1 — Dashboard

**Dov'è**: [ig-dashboard/src/App.jsx](../ig-dashboard/src/App.jsx). Vite + React + Tailwind + recharts.

**Tre mode**:
1. **Live** (locale, `npm run dev`): chiama direttamente Graph API dal browser col token in `src/config.js`.
2. **Static** (deploy GH Pages, `VITE_USE_STATIC=true`): legge `/data.json` pre-generato dal workflow.
3. **Fake** (token vuoto): `src/fakeData.js` genera dati deterministici per UX iterare senza token.

**Sezioni**: hero 4 KPI con delta · reach chart · sintesi · content mix per media_type · post scatter+grid · heatmap giorno×ora · audience condizionale.

## Layer 2 — Archivio storico

**Dov'è**: Turso (`libsql://pulp-leandronesi.aws-eu-west-1.turso.io`), fallback locale `ig-dashboard/data/pulp.db`.

**Schema in 6 tabelle** (autoritativo in [ig-dashboard/scripts/db.js](../ig-dashboard/scripts/db.js)):
- `daily_snapshot` — PK `date`, profilo+totali del giorno (idempotente)
- `post` — PK `post_id`, metadata stabile (upsert)
- `post_snapshot` — PK `(post_id, fetched_at)`, metriche variabili (ogni run = riga nuova → curva di crescita)
- `audience_snapshot` — PK `(date, breakdown, key)`, demographics lifetime
- `run_log` — telemetria esecuzioni
- `meta` — KV cache (es. `ig_user_id`)

**Scritto da**: script Node in `ig-dashboard/scripts/`, eseguiti da GitHub Actions cron.
**Letto da**: skill `pulp-briefing` per analisi, (futuro) dashboard per chart storici.

## Layer 3 — Analista

**Dov'è**: [.claude/skills/pulp-briefing/](../.claude/skills/pulp-briefing/) — skill formalizzata.

**Invocata da**: l'utente, in chat con Claude. Per ora interattiva; a regime anche via `scripts/briefing.js` automatizzato + Gmail MCP.

**Workflow 7-step** (ispirato a `social-media-analyzer` di alirezarezvani):
validate → current aggregates → prev aggregates → outliers → benchmark → voice synthesis → draft report.

## Scheduling

Tre workflow GitHub Actions:

| Workflow | Cron | Cosa fa |
|---|---|---|
| snapshot-daily.yml | `0 22 * * *` | Full snapshot verso Turso |
| snapshot-fresh.yml | `5 */4 * * *` | Fresh-only (post ultimi 7gg) verso Turso |
| publish-dashboard.yml | `15 */4 * * *` + push | Export + build + deploy GH Pages |

Tutti leggono da **GitHub Secrets**: `IG_PAGE_TOKEN`, `IG_PAGE_ID`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`.

## Sicurezza

- Page token mai nel bundle pubblico (vedi [decisions/003-static-deploy.md](decisions/003-static-deploy.md))
- `.env` e `src/config.js` gitignored
- `data/pulp.db` (fallback locale) gitignored — contiene dati IG reali
- App Secret Meta non è mai stato committato (usato solo al momento dell'exchange token)

## Dove vivere i dati

| Cosa | Dove | Commit? |
|---|---|---|
| Codice | repo GitHub | ✅ |
| Brand assets (logo) | `ig-dashboard/public/` | ✅ |
| Token IG | Turso env + GitHub Secrets + `src/config.js` locale | ❌ |
| Page ID | codice (pubblico), Secrets per consistenza | ✅ |
| Dati IG storici | Turso cloud | ❌ (gestito da Turso) |
| Briefing/report | `reports/` (futuro) | ✅ (sono output di analisi, contengono dati ma sono doc nostri) |

## Flussi tipo

**Ogni 4h**: snapshot-fresh → Turso post_snapshot aggiunge righe per i post < 7gg. Publish-dashboard genera nuovo data.json e deploya.

**Ogni notte (22 UTC)**: snapshot-daily → Turso daily_snapshot upsert + audience rifatto.

**Quando utente chiede briefing**: skill `pulp-briefing` legge Turso via query mirate, produce markdown draft. Utente rivede, eventualmente invia.

**Quando utente pushiare codice su main**: publish-dashboard gira → data.json fresco + nuovo build → GH Pages.
