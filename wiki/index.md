# Wiki — The Pulp

Artefatto persistente e compondente di conoscenza sul progetto. Pattern Karpathy: non RAG sulle sorgenti, ma sintesi markdown di concetti, decisioni, audit.

> **Tre livelli:**
> 1. **Sorgenti raw** — codice, CLAUDE.md, dati IG in Turso, post reali, screenshot. Immutabili.
> 2. **Wiki (questa cartella)** — pagine sintetizzate e mantenute dall'LLM. Owns questo layer completamente.
> 3. **Schema** — [ig-dashboard/CLAUDE.md](../ig-dashboard/CLAUDE.md) definisce convenzioni, struttura, workflow del progetto; questa wiki li applica.

## Quando usare

- **Prima di scrivere codice su un pezzo già noto**: leggi `architecture.md` + la decision rilevante prima di toccare.
- **Prima di prendere una decisione ricorrente**: vedi se esiste già una ADR (decisions/). Se sì, rispettala o creane una che la supera.
- **Quando un briefing o analisi tira fuori un pattern nuovo**: salvalo in `audits/` con la data, così non va perso.
- **Ogni volta che cambi qualcosa di non-banale**: append a `log.md`.

## Catalogo

### Architettura
- [architecture.md](architecture.md) — Tre layer (dashboard, archivio, analista) + flussi dati

### Decisioni architetturali (ADR)
- [decisions/001-turso-storage.md](decisions/001-turso-storage.md) — Turso come archivio cloud vs locale/Postgres
- [decisions/002-fresh-vs-full-snapshot.md](decisions/002-fresh-vs-full-snapshot.md) — Split snapshot daily full + fresh ogni 4h
- [decisions/003-static-deploy.md](decisions/003-static-deploy.md) — GH Pages pre-renderato vs proxy backend
- [decisions/004-skill-based-briefing.md](decisions/004-skill-based-briefing.md) — Skill `.claude/skills/pulp-briefing` come source-of-truth
- [decisions/005-graph-api-vs-instagram-login.md](decisions/005-graph-api-vs-instagram-login.md) — FB Graph API, non Instagram Login
- [decisions/006-chat-agent.md](decisions/006-chat-agent.md) — Chat agent dev-only via Vite middleware, function calling su Turso

### Concetti
- [concepts/engagement-rate.md](concepts/engagement-rate.md) — Formula, tier, pitfall
- [concepts/reach-deduplication.md](concepts/reach-deduplication.md) — Perché `sum(daily reach) ≠ reach del range`
- [concepts/post-growth-curve.md](concepts/post-growth-curve.md) — Come `post_snapshot` registra la crescita di un post
- [concepts/token-lifecycle.md](concepts/token-lifecycle.md) — Short-lived → long-lived → Page token, rinnovi

### Audit (snapshot di uno stato in una data)
- [audits/pulp-audience-2026-04-24.md](audits/pulp-audience-2026-04-24.md) — Prima fotografia di audience completa

## Log
Vedi [log.md](log.md) per il cronologico di ingest, modifiche strutturali, audit.
