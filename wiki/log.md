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
