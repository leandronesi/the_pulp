# ig-dashboard · The Pulp

## ⚠️ Prima di tutto: leggi `wiki/` e `TODO.md`

Il progetto usa un **pattern Karpathy**: knowledge compounda in una wiki persistente invece che essere rigenerata ogni sessione.

- **[../wiki/index.md](../wiki/index.md)** — catalogo di tutte le decisioni (ADR), concetti, audit
- **[../wiki/log.md](../wiki/log.md)** — cronologico append-only delle modifiche strutturali
- **[../TODO.md](../TODO.md)** — lista viva di cosa fare, ordinata per priorità. Prima di iniziare qualcosa, guarda qui

Questo `CLAUDE.md` resta lo **schema**: descrive l'architettura dell'ig-dashboard (componenti, script, deploy). La **wiki** registra il perché delle scelte e concetti di dominio. Il **TODO** è operativo.

Ogni volta che si prende una decisione non-banale: append entry in `wiki/log.md` + eventualmente nuova ADR in `wiki/decisions/`.

## Cos'è questo progetto

Non è solo un dashboard — è la **base di un data analyst / social media manager AI** per l'account Instagram "The Pulp · Soave Sia il Vento". Il dashboard è la superficie visibile; l'obiettivo più ampio è che Claude Code diventi l'analista che monitora, diagnostica, produce briefing, e suggerisce il piano editoriale sulla base dei dati IG.

**Pezzi dell'ecosistema:**

1. **Dashboard web** *(✅ fatto)* — visualizzazione live dei dati IG, tutto client-side, usa la Facebook Graph API via Page access token (la Page FB "The Pulp - Soave Sia il Vento" gestisce l'IG Business Account).
2. **Archivio storico SQLite** *(🛠 in costruzione)* — la Graph API non espone storico oltre 90gg e non dà serie temporali di follower. Cron giornaliero scrive snapshot in `data/pulp.db` così col tempo accumuliamo la storia vera.
3. **Briefing automation** *(🔜 prossimo)* — cron settimanale che legge SQLite, confronta periodi, scrive un briefing markdown e lo invia via Gmail MCP.
4. **Sentinella anomalie** *(🔜)* — cron giornaliero che flagga cali sospetti di reach/engagement/follower con alert su email/push.
5. **Post-mortem on-demand** *(🔜 zero setup, serve solo l'archivio)* — "perché questo post è andato così?" → Claude legge SQLite, correla, scrive l'analisi.
6. **Editor piano editoriale** *(futuro)* — suggerimenti di calendario basati su storico (best time, best format, best theme).
7. **Caption buddy + reportistica mensile** *(futuro)*.

**Cose che NON si possono fare, per onestà:**
- Pubblicare per conto dell'utente (Instagram Content Publishing API è gated).
- Analisi competitor via scraping automatico (IG è ostile).
- Girare 24/7 come daemon — Claude Code esegue, lo scheduler triggera a slot precisi.

## Stack

**Frontend (dashboard):**
- **Vite 5** (dev server, build)
- **React 18** (un solo componente monolitico in [src/App.jsx](src/App.jsx))
- **Tailwind 3** (via PostCSS, utility inline nel JSX)
- **recharts** (grafici Area/Bar/Scatter)
- **lucide-react** (icone)

**Backend analytics (scripts Node):**
- **@libsql/client** — client SQLite-compatibile che parla sia file locale che Turso remoto. Unified async API, zero differenze di codice tra i due mode.
- Target DB controllato da env var: se `TURSO_DATABASE_URL` è set → cloud (Turso), altrimenti → `data/pulp.db` locale.
- Script in `scripts/` invocabili via `npm run <nome>`. Caricano `.env` tramite `node --env-file-if-exists=.env`.
- Nessun server HTTP per ora; il dashboard resta client-side, gli script girano separatamente.

## Architettura (90 secondi)

Tutta l'app è in [src/App.jsx](src/App.jsx). Un singolo `useEffect` chiama `graph.facebook.com/v21.0` dal browser. Ogni cambio di `dateRange` o `refreshKey` rifetcha tutto.

**Flusso di fetch:**

1. **Resolve IG User ID** — `GET /{PAGE_ID}?fields=instagram_business_account` → ricava l'`ig_user_id`. Tutte le chiamate successive usano quell'ID.
2. **Profilo** — `GET /{ig_user_id}?fields=username,name,biography,profile_picture_url,followers_count,follows_count,media_count`
3. **Totali account — periodo corrente + precedente** in parallelo. 5 metriche (`reach`, `profile_views`, `website_clicks`, `accounts_engaged`, `total_interactions`) per ogni periodo. I warnings si accumulano solo dal periodo corrente; sul precedente si ignorano silenziosamente. Serve per calcolare i delta vs periodo precedente.
4. **Reach giornaliero** — time series per il grafico ad area.
5. **Media + insights per post** — `insights.metric(reach,saved,shares,views)` embedded; fallback senza insights se fallisce.
6. **Audience demographics** — 4 breakdown paralleli (`age`, `gender`, `city`, `country`) su `follower_demographics`. Silenzioso: se torna errore (di solito sotto 100 follower engaged) la sezione semplicemente non compare.

Errori fatali (resolve Page o profilo KO) vanno in `error`. Il resto finisce in `warnings[]`.

**Derivati `useMemo`:**
- `engagementRate` / `engagementRatePrev` — `total_interactions / reach * 100`
- `reachChartData` — daily area chart
- `enrichedPosts` — post con `reach`, `saved`, `shares`, `views`, `interactions`, `er` precalcolati
- `sortedPosts` — griglia ordinata per `sortMode` (`reach | er | saved | shares`)
- `scatterByType` — post raggruppati per `media_type` per lo scatter plot
- `contentMix` — aggregato per media_type (count, avg reach, avg ER)
- `heatmap` — griglia 7 giorni × 6 fasce orarie (4h ciascuna) con reach medio per cella

**Sezioni render (in ordine):** header → errori/warnings → hero KPIs (4 card con delta) → reach panel + sintesi → content mix → post analysis (scatter + tabs + grid) → best time to post (heatmap) → audience (condizionale) → footer.

## Configurazione

In [src/config.js](src/config.js) (gitignorato):

- `TOKEN` — **Page access token** derivato dallo user token long-lived via `GET /me/accounts`. Page token da user long-lived di solito non scadono (finché l'utente non revoca).
- `PAGE_ID` — ID della Page FB che gestisce l'IG Business Account (`111507393712812`).
- `API` — base URL `https://graph.facebook.com/v21.0`

Il file template committato è [src/config.example.js](src/config.example.js). Dopo clone: `cp src/config.example.js src/config.js` e inserire il token. Questo pattern assicura che il token non finisca mai su GitHub.

**Il token finisce nel bundle JS.** OK in locale, non deployare su URL pubblico senza prima spostare le chiamate dietro un backend.

## Demo mode (TOKEN vuoto)

Quando `TOKEN` in `config.js` è stringa vuota o contiene il placeholder `PASTE…`, il dashboard passa automaticamente in demo mode: [src/fakeData.js](src/fakeData.js) genera dati deterministici (seed basato su `dateRange`) che alimentano tutte le sezioni (KPI, reach daily, post con thumbnail via `picsum.photos`, audience).

Utile per:
- Lavorare su UI/UX senza token valido
- Fare screenshot presentabili senza esporre dati reali
- Vedere come reagisce il layout con diverse forme di dati

Il badge amber `demo · dati fake` nell'header segnala lo stato. Appena incolli un token valido, demo mode si spegne e partono le chiamate reali.

## Avvio

```bash
npm install
npm run dev
```

Apre `http://localhost:5180` automaticamente.

## Permessi richiesti sul token

Perché funzionino tutte le sezioni, lo user token di partenza deve avere:

- `pages_show_list` — per listare le Page via `/me/accounts`
- `pages_read_engagement` — lettura base della Page
- `instagram_basic` — profilo, media dell'IG Business Account
- `instagram_manage_insights` — **tutte le metriche insights** (reach, profile_views, ecc.)

Se vedi errori `(#10) Application does not have permission for this action` sulle metriche, manca `instagram_manage_insights` sullo user token da cui è stato derivato il Page token.

## Generazione token

1. **Graph API Explorer** → app **The Pulp** → seleziona i permessi `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_insights` → **Generate Access Token**
2. Scambialo per uno long-lived:
   ```
   GET https://graph.facebook.com/v21.0/oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id={APP_ID}
     &client_secret={APP_SECRET}
     &fb_exchange_token={SHORT_LIVED_USER_TOKEN}
   ```
3. Chiama `GET /me/accounts?access_token={LONG_LIVED_USER_TOKEN}` — trova la Page "The Pulp - Soave Sia il Vento" e copia il suo `access_token` (quello è il Page access token da mettere in `TOKEN`).
4. Il `PAGE_ID` è già fissato in config (`111507393712812`); cambialo solo se la Page viene ricreata.

## Perché la Facebook Graph API e non Instagram Login

Storia del progetto: la prima iterazione usava FB Graph API + `instagram_manage_insights`. A metà corsa Meta dava errore generico ("Si è verificato un errore. Riprova più tardi") nell'aggiungere `instagram_manage_insights` all'app → migrazione temporanea al flow Instagram Login (`graph.instagram.com` + famiglia `instagram_business_*`). Sistemato il blocco lato Meta, siamo tornati alla Facebook Graph API perché è il flow canonico per dashboard business lato Page.

Differenze chiave rispetto al flow Instagram Login:
- Endpoint: `graph.facebook.com` (non `graph.instagram.com`)
- Auth: Page access token derivato da user long-lived (non token IG diretto)
- Identificatore: servono `PAGE_ID` + resolve runtime dell'`ig_user_id` (non `me`)
- Permessi: `pages_*` + `instagram_basic` + `instagram_manage_insights` (non famiglia `instagram_business_*`)

## Data layer (SQLite/Turso)

Archivio storico per costruire ciò che la Graph API non espone: serie temporali di follower, evoluzione reach/engagement dei singoli post nel tempo, demographics storiche.

**Due target supportati tramite @libsql/client:**
- **Turso (remoto)** — set `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` in `.env`. Produzione / always-on / accessibile da cron cloud.
- **SQLite locale (fallback)** — se env non sono set, usa `data/pulp.db` (gitignorato). Utile per dev offline.

Schema identico su entrambi — stesso SQL, stesse query. La scelta del target è trasparente al codice.

**Tabelle** (schema autoritativo in [scripts/db.js](scripts/db.js)):

| Tabella | Cardinalità | Chiave | Cosa ci va |
|---|---|---|---|
| `daily_snapshot` | 1 riga/giorno | `date` (YYYY-MM-DD Europe/Rome) | Followers, follows, media_count + 5 metriche del giorno (reach, profile_views, website_clicks, accounts_engaged, total_interactions). Idempotente: ri-run dello stesso giorno aggiorna la riga. |
| `post` | 1 riga/post | `post_id` | Metadata stabile: timestamp, media_type, caption, permalink, URL thumbnail. Aggiornato on-upsert ad ogni snapshot. |
| `post_snapshot` | N righe/post | `(post_id, fetched_at)` | Metriche variabili nel tempo (like, comments, reach, saved, shares, views). **Ogni fetch crea una nuova riga** → permette di ricostruire la curva di crescita di ogni post. |
| `audience_snapshot` | ~20 righe/giorno | `(date, breakdown, key)` | Demographics dei follower — breakdown ∈ {age, gender, city, country}. |
| `run_log` | 1 riga/esecuzione | auto | Telemetria: quando, che tipo di script, esito, errori. |
| `meta` | KV | `key` | Valori cacheati: `ig_user_id`, eventuali altri config. |

**Helpers in [scripts/db.js](scripts/db.js) (tutti async):**
- `getDb()` — apre client libsql (Turso o file locale), applica schema (idempotente)
- `getDbMode()` / `getDbTarget()` — "turso"/"local" + URL target, per logging
- `todayIsoDate()` — data di oggi in timezone Europe/Rome
- `startRunLog(kind)` / `endRunLog(id, {status, summary, error})` — tracciano le esecuzioni
- `setMeta(key, value)` / `getMeta(key)` — KV store
- `countTables()` — conteggi rapidi delle tabelle principali

## Script analytics

Invocabili via `npm run <nome>` dalla root di `ig-dashboard/`:

| Script | File | Cosa fa |
|---|---|---|
| `npm run init-db` | [scripts/init-db.js](scripts/init-db.js) | Apre/crea il DB (Turso o locale), applica schema, stampa conteggi. Idempotente. |
| `npm run snapshot` | [scripts/snapshot.js](scripts/snapshot.js) | **Full snapshot**: fetch completo → `daily_snapshot`, `post` + `post_snapshot` (tutti i 30), `audience_snapshot`. Pensato per cron giornaliero. |
| `npm run snapshot:fresh` | [scripts/snapshot.js](scripts/snapshot.js) `--fresh-only` | **Fresh snapshot**: solo post pubblicati negli ultimi 7gg (configurabile via `FRESH_WINDOW_DAYS`), solo `post` + `post_snapshot`. Pensato per cron ogni 4h per curve di crescita fini. |
| `npm run export-json` | [scripts/export-json.js](scripts/export-json.js) | Pre-renderizza `public/data.json` con 3 range (7/30/90g) per il deploy GitHub Pages. Graph API + Turso (per history). |
| `npm run briefing` | [scripts/briefing.js](scripts/briefing.js) | Briefing (default 7g) leggendo Turso + OpenAI per sezioni narrative. Output markdown in `reports/briefing-YYYY-MM-DD-Nd.md`. Flag: `--period=7d\|14d\|30d\|90d`, `--output=file\|stdout`, `--no-llm`. Env: `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-5.4-mini`). |

**Risoluzione delle credenziali IG (in ordine di priorità):**
1. `process.env.IG_PAGE_TOKEN` / `IG_PAGE_ID` / `IG_API` — utile su CI
2. Import da `src/config.js` se il file esiste
3. Stringa vuota → fake mode (esce senza scrivere)

Ogni script è ESM, carica `.env` tramite il flag `--env-file-if-exists` di Node 20+, e rispetta `isFakeToken(TOKEN)`.

## Deploy pubblico (GitHub Pages)

Il dashboard è deployato su GitHub Pages come sito statico pre-renderato. Pattern:

1. Workflow [.github/workflows/publish-dashboard.yml](../.github/workflows/publish-dashboard.yml) gira ogni 4h (cron `15 */4 * * *`) + su ogni push a `main` che tocca `ig-dashboard/**`.
2. Lo step "Export data.json" chiama la Graph API lato server (token dal GitHub Secret `IG_PAGE_TOKEN`) e scrive `ig-dashboard/public/data.json` con profilo, 30 post, audience e 3 range pre-calcolati (7/30/90g).
3. Lo step "Build" esegue `VITE_USE_STATIC=true VITE_PUBLIC_PATH=/the_pulp/ npm run build`. Il flag static fa sì che [src/App.jsx](src/App.jsx) carichi `/data.json` invece di chiamare Graph API direttamente.
4. Deploy via `actions/upload-pages-artifact` + `actions/deploy-pages`.

**Sicurezza**: il Page token non finisce MAI nel bundle JS del sito pubblico. Le chiamate Graph API avvengono solo lato workflow (ambiente sicuro GitHub Actions). Chi visita il sito vede solo il JSON pre-renderato.

**URL pubblica**: `https://leandronesi.github.io/the_pulp/` (dopo che Pages è abilitato con source "GitHub Actions" nelle repo Settings → Pages).

**Dev locale resta invariato**: `npm run dev` usa il path live Graph API con token da `src/config.js`, come sempre.

## Skills formalizzate (`.claude/skills/`)

Skill Claude Code per ruoli analitici ricorrenti. Ispirate a pattern consolidati nella community (vedi "Ricerca di riferimento" sotto), non inventate ex-novo.

| Skill | File | Quando invocarla |
|---|---|---|
| `pulp-briefing` | [.claude/skills/pulp-briefing/SKILL.md](../.claude/skills/pulp-briefing/SKILL.md) | Briefing settimanali/mensili sui dati IG — delta vs periodo prec., hero/bottom post, pattern, azioni. Basata su social-media-analyzer (7 step) + Stormy AI pattern skill.md come KPI/voice source-of-truth. |
| `frontend-design` | [.claude/skills/anthropic-frontend-design/SKILL.md](../.claude/skills/anthropic-frontend-design/SKILL.md) | Skill ufficiale Anthropic. Invocala ogni volta che tocchi UI/styling/componenti React del dashboard. Linea guida: evitare AI-slop aesthetics, typography distintiva, palette bold intenzionale, motion con significato. |
| `ui-ux-pro-max` | [.claude/skills/ui-ux-pro-max/SKILL.md](../.claude/skills/ui-ux-pro-max/SKILL.md) | Design intelligence database: 50+ stili, 161 palette, 57 font pairings, 99 UX guidelines, 25 chart types. Per decisioni di design system (colori, tipografia, layout) o review UI quality. CLI Python opzionale (`scripts/search.py`) per query mirate. |

La skill `pulp-briefing` include sotto [references/](../.claude/skills/pulp-briefing/references/): `schema.md` (query tipiche su Turso), `brand-context.md` (voice + audience Pulp), `benchmarks.md` (tier IG per ER, reach, growth).

## Ricerca di riferimento

Aprile 2026, esploriamo cosa esisteva già nel mondo Claude Code + social per non reinventare. Risorse consultate e pattern incorporati:

- [alirezarezvani/claude-skills — social-media-analyzer](https://github.com/alirezarezvani/claude-skills/blob/main/marketing-skill/social-media-analyzer/SKILL.md) — **workflow a 7 step** (validate → compute per-post → aggregate → ROI → benchmark → identify → recommend), riadattato in `pulp-briefing/SKILL.md` (no ROI step perché non abbiamo spend pubblicitario).
- [moboutrig/instagram-claude-skill](https://github.com/moboutrig/instagram-claude-skill) — skill Python per publishing + analytics IG. Noi siamo **solo analytics**, senza publishing (Instagram Content Publishing è gated). Utile come referenza di copertura comandi.
- [mcpware/instagram-mcp](https://github.com/mcpware/instagram-mcp) / [jlbadano/ig-mcp](https://github.com/jlbadano/ig-mcp) — MCP server IG Graph API, 23+ tool. Decisione: **non li usiamo**, preferiamo script Node diretti perché abbiamo più controllo sulla persistenza e sul flow fetch→Turso.
- [Stormy AI — Automate Social Media Reporting with Claude Code](https://stormy.ai/blog/automate-social-media-reporting-claude-code) — pattern: `skill.md` come **source of truth** per KPI/brand voice/report format, **CLAUDE.md** per struttura progetto, **human-in-the-loop** sui report AI-generati. Tutti adottati.
- [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) — collezione generica (CRO/copy/SEO/analytics). Meno verticale del nostro.

## Scheduling cloud (GitHub Actions)

Due workflow in [.github/workflows/](../.github/workflows/) runnano indipendentemente sul runner Ubuntu di GitHub Actions — non serve che il tuo PC sia acceso:

| Workflow | Cron | Mode | Cattura |
|---|---|---|---|
| [snapshot-daily.yml](../.github/workflows/snapshot-daily.yml) | `0 22 * * *` (22:00 UTC) | full | Tutto: profilo, totali, 30 post, audience |
| [snapshot-fresh.yml](../.github/workflows/snapshot-fresh.yml) | `5 */4 * * *` (ogni 4h, offset 5min) | fresh-only | Solo post pubblicati negli ultimi 7gg |

Entrambi hanno `workflow_dispatch` → trigger manuale dalla UI GitHub (tab **Actions**).

**GitHub Secrets necessari** (repo → Settings → Secrets and variables → Actions):
- `IG_PAGE_TOKEN` — Page access token non-expiring
- `IG_PAGE_ID` — `111507393712812`
- `TURSO_DATABASE_URL` — URL del DB Turso
- `TURSO_AUTH_TOKEN` — JWT del DB Turso

I workflow NON committano nulla al repo. Il DB vive su Turso, accessibile anche dal locale (stesse env in `.env`).

## File principali

- [src/App.jsx](src/App.jsx) — tutto: fetch, state, render, subcomponents (`KpiCard`, `DeltaPill`, `SummaryRow`, `ContentTypeTile`, `PostCard`, `Metric`, `AudiencePanel`, `DarkTooltip`, `ScatterTooltip`)
- [src/config.js](src/config.js) — token + page id + API base
- [src/fakeData.js](src/fakeData.js) — generatore demo (con `isFakeToken`)
- [src/main.jsx](src/main.jsx) — bootstrap React
- [src/index.css](src/index.css) — `@tailwind base/components/utilities`
- [scripts/db.js](scripts/db.js) — DB layer condiviso (libsql, target Turso o file)
- [scripts/init-db.js](scripts/init-db.js) — init schema
- [scripts/snapshot.js](scripts/snapshot.js) — daily snapshot
- [.env](.env) — credenziali Turso (gitignorato); template in [.env.example](.env.example)
- [data/pulp.db](data/pulp.db) — SQLite fallback locale (gitignorato, usato solo se Turso non è configurato)
- [public/logo-mark.jpeg](public/logo-mark.jpeg) / [public/logo-wordmark.jpeg](public/logo-wordmark.jpeg) — brand assets
- [vite.config.js](vite.config.js) — porta 5180 + `open: true` + `strictPort`
- [tailwind.config.js](tailwind.config.js) / [postcss.config.js](postcss.config.js) — setup Tailwind

## Palette brand

Monocromatica verde foresta + cream, derivata dal logo:
- Background radiale: `#164F3F` → `#0B3A30` → `#052019`
- Primary cream: `#EDE5D0`
- Gold: `#D4A85C` · Terracotta: `#B8823A` · Deep gold: `#B88A4A`
- Sage: `#7FB3A3` / `#8FB5A3` · Mid green: `#3E7A66` · Deep: `#0E4A3E`
- Delta up (sage) / down (terracotta soft `#D98B6F`)
- I colori sono inline in JSX via Tailwind arbitrary values, non definiti nel `tailwind.config.js`.

## Convenzioni

- Lingua UI e comunicazione: **italiano** (label, errori, commit message, commenti script).
- Font: Fraunces (display) + JetBrains Mono (testo tech), caricati via `@import` inline.
- Stile: dark glassmorphism, palette verde foresta + cream (vedi sezione Palette).
- Nessun test, nessun lint config, nessun routing.
- App.jsx resta **monolitico** finché non diventa ingestibile — non splittare preventivamente in tanti componenti.
- Tutti i colori inline via arbitrary values Tailwind, non definiti in `tailwind.config.js`.

## Preferenze operative (regole del progetto)

- **Decisività**: quando i dati che l'utente passa (token, endpoint, scope, output API) dichiarano già l'intento, procedere senza chiedere conferma. Fare domande solo se l'azione è distruttiva o se il path richiederebbe rewrite enormi di file non correlati.
- **Refactor locali e reversibili** → esegui direttamente, non proporre e aspettare.
- **Non duplicare memorie**: quello che è già in CLAUDE.md non va salvato anche in memory system.
- **Demo mode va preservato**: `TOKEN=""` in `config.js` deve continuare a funzionare con dati fake, è lo strumento di lavoro sul dashboard.

## Quando tocca rimettere le mani

- **Token scaduto/revocato** → ri-genera lo user token dal Graph API Explorer, scambialo long-lived, ricava il Page token da `/me/accounts`, aggiorna `TOKEN` in `src/config.js`.
- **Metrica nuova di IG** → aggiungi al `metrics[]` array in `App.jsx` e crea la relativa `<MiniStat />` o sezione.
- **Bump versione API** (es. v21→v22) → cambia `API` in `config.js` e verifica breaking changes nel [changelog Graph API](https://developers.facebook.com/docs/graph-api/changelog).
- **Deploy pubblico** → richiede refactor: spostare le chiamate dietro un piccolo backend (es. Node/Express, Cloudflare Worker) per non esporre il Page token.
