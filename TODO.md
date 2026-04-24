# TODO — The Pulp

Lista viva. Aggiornata ad ogni sessione. Quello che è `[x]` non serve più discutere — cercare in [wiki/log.md](wiki/log.md) se si vuole contesto.

**Convenzione**:
- `[x]` fatto, **linkare dove vive il risultato**
- `[ ]` da fare, priorità via sezione
- `[~]` in corso / parziale
- Ogni item ha 1 riga. Se serve contesto, creare una pagina in `wiki/` e linkare.

---

## ✅ Done (recente → vecchio)

- [~] `scripts/briefing.js` v0.1 scaffold — [reports/briefing-2026-04-24-7d.md](reports/briefing-2026-04-24-7d.md) primo test. LLM narrative ancora da integrare
- [x] Tooltip contestuali (InfoTip) su KPI/pill/sintesi — [wiki/log.md](wiki/log.md) 2026-04-24
- [x] Dashboard arricchito: tier pill, sparkline per post, follower trend — [wiki/log.md](wiki/log.md) 2026-04-24
- [x] Dashboard + skill + wiki pattern Karpathy consolidato — [wiki/log.md](wiki/log.md) 2026-04-24
- [x] Deploy pubblico GH Pages con token mai nel bundle — [wiki/decisions/003-static-deploy.md](wiki/decisions/003-static-deploy.md)
- [x] Skill `pulp-briefing` formalizzata — [.claude/skills/pulp-briefing/](.claude/skills/pulp-briefing/)
- [x] Migrazione storage Turso — [wiki/decisions/001-turso-storage.md](wiki/decisions/001-turso-storage.md)
- [x] Split snapshot daily full + fresh ogni 4h — [wiki/decisions/002-fresh-vs-full-snapshot.md](wiki/decisions/002-fresh-vs-full-snapshot.md)
- [x] Scheduling via GitHub Actions con Secrets
- [x] Dashboard con 7 sezioni: hero/reach/sintesi/content-mix/post-analysis/heatmap/audience
- [x] Demo mode con fakeData deterministico
- [x] Audit audience iniziale — [wiki/audits/pulp-audience-2026-04-24.md](wiki/audits/pulp-audience-2026-04-24.md)

---

## 🔥 Prossimi (ordine suggerito)

### 1. Primo briefing reale
- [ ] Aspettare **≥5 daily_snapshot** accumulati (serve ~5 giorni dopo il 24/4 → ~29/4)
- [ ] Invocare skill `pulp-briefing` interattiva: "fammi il briefing settimanale"
- [ ] Revisione con utente → iterare il template se emergono debolezze
- [ ] Salvare draft in `reports/briefing-YYYY-MM-DD.md` + log entry in wiki

### 2. `scripts/briefing.js`
- [x] Estrarre le query dalla skill in funzioni Node riusabili
- [x] CLI: `npm run briefing -- --period=7d|14d|30d|90d --output=file|stdout`
- [x] Output markdown in `reports/`
- [x] Run_log entry kind='briefing'
- [ ] **LLM narrative** — integrare Anthropic SDK per compilare sezioni `_[placeholder]_` (Headline, analisi hero/bottom, Azioni). Legge `.claude/skills/pulp-briefing/references/brand-context.md` come system prompt, usa Claude Opus 4.7

### 3. Delivery briefing via Gmail MCP
- [ ] Workflow cron lun 8:00 IT che genera briefing + lo invia
- [ ] MCP Gmail configuration (già disponibile in env)
- [ ] Mittente e subject: "The Pulp · Briefing settimanale sett. NN"

---

## 🟡 Medium term (quando c'è più dati accumulati)

### Dashboard arricchito
- [x] **Growth curve per post** come sparkline in PostCard — scritto il 2026-04-24, curva si riempie via via che post_snapshot accumula
- [x] **Follower trend** come sparkline nella KpiCard Followers — necessita ≥2 daily_snapshot per apparire
- [x] **Benchmark pill** sotto ER nel hero — tier excellent/good/avg/poor
- [ ] **Audience shift**: delta tra due date sui breakdown demographics (serve ≥2 audience_snapshot)
- [ ] Chart dedicato "Trend storico" con reach+engaged+interactions nel tempo (oltre al solo followers sparkline)
- [ ] Quando un post ha storico ricco (>10 punti), permettere click → modal con chart full-size e tutte le metriche (reach/like/saved/shares) overlaid
- [ ] **Refresh rate check**: il publish-dashboard workflow potrebbe leggere da Turso invece di rifetchare Graph API (riduce call a Meta, unifica source of truth). Vedi nota in [wiki/decisions/003-static-deploy.md](wiki/decisions/003-static-deploy.md)

### Analisi on-demand
- [ ] `scripts/postmortem.js --post <post_id>`: analisi puntuale di un singolo post con curva, confronto vs media, deviazioni. Skill separata `.claude/skills/pulp-postmortem/`
- [ ] Query tool `npm run query`: comandi nominati (`reach-last-30`, `top-posts`, `follower-growth`) invece di SQL manuale

### Observability
- [ ] Page sul dashboard (o sezione separata) che mostra `run_log` — ultimi successi/fallimenti dei cron. "Hai avuto il tuo ultimo snapshot fresh alle 16:05 · status ok"

---

## 🔮 Blue sky (non prima di aver consolidato sopra)

- [ ] Scope `instagram_manage_comments` → analisi sentiment commenti (richiede app review Meta)
- [ ] Scope `instagram_manage_messages` → DM analytics (idem)
- [ ] "Caption buddy" — skill per revisione caption pre-publish con suggerimenti
- [ ] Content calendar editor — suggerimenti di piano editoriale
- [ ] Predictive "best time to post" → oltre la heatmap, modello vero
- [ ] Audit periodici automatici (skill `pulp-audit`: shift audience mensile, anomalie, ecc.)
- [ ] Supporto multi-account se mai Pulp ne gestisse altri (parametrizzare skill)

---

## 🧹 Debiti tecnici / ripuliture

- [ ] Unificare logica fetch Graph API: [scripts/snapshot.js](ig-dashboard/scripts/snapshot.js) e [scripts/export-json.js](ig-dashboard/scripts/export-json.js) hanno molte funzioni simili. Estrarre in `scripts/ig-fetch.js`
- [ ] `export-json.js` potrebbe leggere da Turso per `posts` + `audience` invece di ri-chiamare Graph API (risparmio call). Richiede piccolo refactor
- [ ] `dist/` potrebbe stare in .gitignore (attualmente sì, verificare)
- [ ] `data/pulp.db` locale è fossile post-migrazione Turso. Decidere: cancellarlo o lasciarlo come fallback (e documentare)

---

## Come usare questa lista

- **Prima di ogni sessione**: leggi questo file. Decidi da dove partire
- **Quando completi qualcosa**: sposta da `[ ]` a `[x]` + aggiungi link a dove vive il risultato + append log entry
- **Quando emerge qualcosa di nuovo**: aggiungilo con contesto minimo. Se il contesto è >2 righe, crea una pagina wiki e linka
- **Non far diventare questo file un brain-dump**: se una sezione diventa >15 item, ristruttura con sotto-pagine
