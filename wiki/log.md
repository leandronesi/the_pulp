# Log — The Pulp wiki

Append-only. Ogni entry ha formato `## [YYYY-MM-DD] kind | Title`.

Tipi di kind:
- `init` — creazione nuova sezione/struttura
- `ingest` — aggiunta di una sorgente elaborata nella wiki
- `decision` — ADR committata
- `audit` — snapshot di stato (dati, metriche) salvato
- `refactor` — modifica strutturale al codice documentata qui
- `note` — osservazione utile senza altra casa

---

## [2026-04-24] fix | Date picker rebuild: Radix Popover + react-day-picker (stile brand)
- Il primo tentativo era un popover custom `position: absolute z-50` che veniva coperto dai KpiCard (stacking context con `overflow-hidden`) + native date inputs brutti. Consigliato dall'utente: "non posso credere che t'hanno consigliato sta merda" — fair.
- Rebuild usando le skill installate:
  - **@radix-ui/react-popover**: portal su document.body → zero stacking, collision detection, auto-flip. Trigger è asChild sul bottone custom
  - **react-day-picker** v9: calendar range con `mode="range"`, locale `it` da date-fns, `weekStartsOn={1}` (lunedì), `disabled={{after: new Date()}}` (niente date future)
  - `numberOfMonths={1}` per compattezza
- Styling brand-specifico via classe `.pulp-calendar` in [src/index.css](../ig-dashboard/src/index.css):
  - Background gradient verde foresta, border cream soft
  - Font header "Fraunces" italico per il mese, "JetBrains Mono" per i numeri (coerente col resto del dashboard)
  - Giorno selected: cream pieno #EDE5D0 con testo verde scuro. Range middle: cream 18% opacity senza border-radius. Today: dot cream sotto
  - Nav button glass con hover cream
  - Giorni futuri disabilitati con opacity 20%
- Popover container: gradient glass verde (non più glass generica) + arrow Radix che punta al trigger
- Header del popover in display-font: "scegli un periodo" italico + sub "clicca due date per definire il range" + contatore giorni dinamico nella top-right
- Bundle size +100KB (react-day-picker + Popover), prezzo accettabile per fixare UX rotta

## [2026-04-24] feat | Date picker custom + state refactor
- State `dateRange` (int) → `selection` (oggetto: preset o customFrom/customTo)
- Derivati via useMemo: `days`, `sinceUnix`, `untilUnix` — single source of truth. useEffect watcha sinceUnix/untilUnix
- Nuovo componente `DateRangeSelector`: 3 preset pills + bottone custom con popover (2 `<input type="date">` con max=oggi, apply/cancel, label dinamico "da 15 apr → 22 apr")
- In static mode il custom è disabilitato (data.json ha solo 7/30/90 precomputati). Tooltip spiega il perché
- Fetch useEffect ora usa `sinceUnix`/`untilUnix` direttamente: supporta qualunque range, il prev period viene sempre calcolato come span precedente di pari durata
- Retrocompat: `dateRange` è ancora disponibile come alias per `days` nei label esistenti ("Reach · 15g", "ultimi 15 giorni") — nessun label hardcoded rotto

## [2026-04-24] feat | UX revamp: Radix tooltip + metriche 2026 (save rate, share rate, views)
- Installato `@radix-ui/react-tooltip` (Radix usa Floating UI internamente → collision detection, auto-flip, portal corretto, ARIA nativo, keyboard). Rewrite completo di InfoTip come wrapper sottile sopra `RTooltip.*`. Rinominato import per evitare collisione con `Tooltip` di recharts.
- **Reach rate** come nuovo pill nel hero KPI Reach (reach/follower × 100): tier viral >100% · strong 30-100% · normal 10-30% · low <10%. Un account da 474 vede subito se il contenuto è rimasto interno o ha bucato.
- **Save rate** in Sintesi (saves/reach × 100). Dai benchmark 2026 Meta dà peso ~5× ai salvataggi. Tier: >2% excellent, 1-2% good, 0.5-1% avg, <0.5% poor.
- **Share rate** in Sintesi (shares/reach × 100). Tier: >1.5% excellent, 0.5-1.5% good, <0.5% avg.
- **Views totali** in Sintesi per video/reel. Dal 2025 Meta ha unificato "impressions" in "views" (una voce sola).
- **Views pill sulle thumbnail** dei post video/reel, in stack con ER pill (bottom-right).
- Fonti benchmark: [Sprout Social 37 metrics 2026](https://sproutsocial.com/insights/instagram-metrics/), [Socialinsider 23 metrics](https://www.socialinsider.io/blog/instagram-metrics/), [Sociality.io IG analytics 2026](https://sociality.io/blog/instagram-analytics/).

## [2026-04-24] feat | Installate skill frontend ufficiali (frontend-design Anthropic + ui-ux-pro-max)
- Scaricate due skill comunitarie/ufficiali che saranno usate quando Claude lavorerà su UI in questo progetto:
  - **[.claude/skills/anthropic-frontend-design/](../.claude/skills/anthropic-frontend-design/)** — skill ufficiale Anthropic (277k+ install). SKILL.md opinionato: evitare AI-slop aesthetics, typography distintiva (no Inter/Roboto), palette bold, motion con intentionality, layout inaspettati. Da `anthropics/skills` GitHub.
  - **[.claude/skills/ui-ux-pro-max/](../.claude/skills/ui-ux-pro-max/)** — 2MB: SKILL.md di 45KB con 50+ stili, 161 palette, 57 font pairings, 99 UX guidelines, 25 chart types. CLI Python `scripts/search.py` per query design system. CSV data in `data/` + templates.
- Motivazione: non fare "frontend brutti come la morte" (parole utente). Claude in sessioni future su UI deve consultarle prima di scrivere CSS/componenti.
- Note: la CLI Python di ui-ux-pro-max richiede python3 installato per funzionare. La skill funziona anche senza — SKILL.md è leggibile da LLM e le CSV si possono parsare direttamente.

## [2026-04-24] feat | Chat agent dev-only ("Chiedi al Pulp")
- ADR [006-chat-agent](decisions/006-chat-agent.md) — C3 (spiegatore + analista con query) via Vite middleware, Phase 1 solo in dev, Phase 2 futuro per Cloudflare Worker
- **Backend**: [scripts/chat-plugin.js](../ig-dashboard/scripts/chat-plugin.js), plugin Vite con `apply:"serve"`. Registra `POST /api/chat` e `GET /api/chat-status`. System prompt da brand-context + benchmarks + schema + concetti wiki + dashboard state. Tool calling OpenAI con `queryTurso(sql)` — guard SELECT-only, reject keyword mutanti, enforce LIMIT, timeout implicito libsql
- **Frontend**: [src/Chat.jsx](../ig-dashboard/src/Chat.jsx), pulsante flottante + drawer laterale, glass coerente, history in localStorage. Tool call rendering: SQL in `<pre>` + tabella risultati max 10 righe
- **Gating**: montato solo se `import.meta.env.DEV` → tree-shake completo dal bundle statico pubblico (verificato `grep "chiedi al pulp" dist/assets/*.js` = 0)
- **Override**: `VITE_CHAT_DISABLED=true` per disabilitare anche in dev
- **Test end-to-end**: domanda "qual è il post con più reach nel mio archivio?" → LLM genera SQL con GROUP BY + MAX(reach) + ORDER BY + LIMIT, query in 875ms su Turso, risposta editoriale corretta ("video del 20 marzo 2026 con 3113 reach, caption assente")
- Token per turno con tool call: ~16k (system prompt pesante). Costo gpt-5.4-mini = centesimi/giorno anche con uso intensivo

## [2026-04-24] refactor | Debiti tecnici: unify fetch + audience da Turso + pulizia
- **Nuovo modulo** [scripts/ig-fetch.js](../ig-dashboard/scripts/ig-fetch.js) con tutte le fetch verso Graph API: `createGql`, `resolveIgUserId`, `fetchProfile`, `fetchDayTotals`, `fetchReachDaily`, `fetchMedia`, `fetchAudience`, `loadCredentials`, `metricOf`, `rangeSinceUntil`.
- `snapshot.js` e `export-json.js` rifattorizzati per importare da ig-fetch: ~150 righe di duplicazione eliminate. Drift tra i due script impossibile da ora: se Meta cambia un campo API, si tocca ig-fetch.js e basta.
- `export-json.js` ora legge audience **da Turso** se disponibile (fallback Graph API). Risparmio: 4 call Graph API per ogni export run (24 call/giorno × 4h cron = 96 call/giorno → circa 480 al mese).
- Pulizia: rimosso `data/pulp.db` locale (post-migrazione Turso era fossile). Il fallback a file locale resta nel codice per dev offline ma il file file non è più presente.
- `dist/` già gitignored, verificato.

## [2026-04-24] fix | InfoTip → React Portal (fix tooltip nascosti)
- Bug: i tooltip erano clippati dai container con `overflow-hidden` (KpiCard, PostCard) e coperti dallo stacking context delle glass-card
- Fix: InfoTip ora usa `createPortal` a `document.body`. Posizione calcolata da `getBoundingClientRect()` del trigger, `position:fixed` + `z-[9999]`
- Auto-flip up/down in base allo spazio residuo (soglia 120px)
- Anche clamp horizontal per non uscire dal viewport
- Prop `side` ignorato in favore del flip automatico (retrocompat senza break)
- Aggiunto handler click come fallback per touch device

## [2026-04-24] refactor | briefing.js v0.2 — LLM narrative via OpenAI
- Integrato step 6 della skill: OpenAI API (default `gpt-5.4-mini`) compila Headline, analisi hero/bottom, 3 azioni
- System prompt include brand-context.md + benchmarks.md letti da `.claude/skills/pulp-briefing/references/`
- User prompt passa JSON con tutti i dati calcolati (numeri, hero, bottom, pattern)
- Response format: `json_object` con schema `{ headline, heroAnalysis, bottomAnalysis, actions[3] }`
- Fallback placeholder se `OPENAI_API_KEY` manca o `--no-llm`
- Primo briefing LLM-powered generato: `reports/briefing-2026-04-24-7d.md` (4000 chars, 3397+721 tok)
- Risultato buono: italiano editoriale, trattini, cita post concreto, azioni con cosa/perché/come-misurare
- Limitazione osservata: con sample piccolo (1 daily_snapshot → reach 141) il tier ER "excellent" è distorto. L'LLM lo contestualizza parzialmente ma non dichiara esplicitamente la distorsione. Miglioreremo il prompt quando vedremo più briefing

## [2026-04-24] init | scripts/briefing.js — scaffold (v0.1)
- Implementati step 1-5 e 7 della skill pulp-briefing come script Node standalone
- Query su Turso: `daily_snapshot` aggregates + post del periodo con ultimo `post_snapshot`
- Output markdown in `reports/briefing-YYYY-MM-DD-Nd.md` con sezioni: Headline, Numeri, Hero, Sotto-media, Pattern per media_type, Azioni, Note di metodo
- Step 6 (brand voice / narrative synthesis) lasciato come placeholder `_[...]_` → richiede LLM call, rimandato a iterazione successiva
- CLI: `npm run briefing [-- --period=7d|14d|30d|90d] [--output=file|stdout]`
- Primo briefing reale generato: `reports/briefing-2026-04-24-7d.md`. Sample piccolo (1 daily_snapshot) produce ER distorto (12.1%) perché reach basso — diventerà robusto con più giorni accumulati
- run_log kind='briefing' per telemetria

## [2026-04-24] refactor | UI tooltip contestuali (InfoTip)
- Component `InfoTip` in App.jsx — piccolo (i) hoverabile, popover glass
- Tooltip su: DeltaPill (spiega "vs prec."), tier pill, hero KPI label (Followers/Seguiti/Reach/Engagement), SummaryRow (Account coinvolti, Interazioni totali, Profile views, Website clicks)
- Default `side="up"` per evitare clipping nei card con `overflow-hidden`; `side="down"` dove il label è in alto
- Non aggiunto su Heatmap/Content mix/Post analysis perché hanno già sottotitolo esplicativo

## [2026-04-24] refactor | Dashboard arricchito: tier pill, sparkline, trend
- `erTier()` in App.jsx mappa ER su excellent/good/avg/poor usando [benchmarks.md](../.claude/skills/pulp-briefing/references/benchmarks.md). Pill renderizzato sotto l'ER nel hero card
- `Sparkline` component (recharts AreaChart minimale) sotto ogni PostCard che ha ≥2 righe in `post_snapshot` — curva di reach nel tempo visibile a colpo d'occhio
- Sparkline follower trend nella KpiCard dei Followers (si riempie da ≥2 `daily_snapshot`)
- `scripts/export-json.js` ora legge anche da Turso: `post_snapshot` per histories + `daily_snapshot` serie trend. Aggiunto `postHistory` e `followerTrend` al payload data.json (81KB → 87KB)
- Workflow `publish-dashboard.yml` passa anche TURSO_DATABASE_URL e TURSO_AUTH_TOKEN all'export step
- `fakeData.js` ora genera histories sigmoidi e trend follower coerenti per il demo mode

## [2026-04-24] init | Wiki bootstrap in pattern Karpathy
- Creata struttura `wiki/`: `index.md`, `log.md`, `architecture.md`, `decisions/`, `concepts/`, `audits/`
- Primi 5 ADR ingested dalle discussioni precedenti (Turso, fresh/full split, static deploy, skill briefing, FB Graph API)
- Primi 4 concept pages (engagement-rate, reach-deduplication, post-growth-curve, token-lifecycle)
- Primo audit: `pulp-audience-2026-04-24.md` con la fotografia iniziale (474 follower, 66% Roma, 58% F)
- CLAUDE.md aggiornato per referenziare wiki + TODO come convenzione di progetto

## [2026-04-24] decision | Deploy pubblico GH Pages, non proxy
- Dopo workflow rosso su export-json per token mancante sui Secrets
- Deciso static pre-render (ADR 003) invece di Cloudflare Worker proxy: più semplice, zero nuove infra, token mai nel bundle
- Implementato `scripts/export-json.js` + workflow `publish-dashboard.yml` + static mode in `App.jsx`
- URL live: https://leandronesi.github.io/the_pulp/

## [2026-04-24] audit | Turso popolato con primo snapshot reale
- `npm run snapshot` manuale dopo la migrazione libsql: 474 followers, 30 post, 62 audience rows, 0 errors
- IG User ID cachato in meta: `17841463545841994`
- Page token Page non-expiring (derivato da user long-lived 60gg)

## [2026-04-24] decision | Skill `pulp-briefing` formalizzata
- Adattata da `social-media-analyzer` di alirezarezvani (7-step workflow)
- Pattern Stormy AI: skill.md come source-of-truth di KPI/voice/format
- References: schema.md, brand-context.md, benchmarks.md
- Scritta ma non ancora invocata su dati reali — serve ≥5 daily_snapshot accumulati per avere delta significativi
