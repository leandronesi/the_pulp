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
