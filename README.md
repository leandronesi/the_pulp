# The Pulp — Instagram analytics

Dashboard + archivio storico + base per un data analyst AI sui dati Instagram dell'account **The Pulp · Soave Sia il Vento**.

Non è solo un dashboard: è il seme di un social media manager dati-driven. Il dashboard è la superficie visibile; l'obiettivo più ampio è che i dati fluiscano in un archivio SQLite su cui Claude Code possa produrre briefing settimanali, diagnosi on-demand, e suggerimenti di piano editoriale.

## Struttura

```
the_pulp/
├── ig-dashboard/          # L'app Vite + React + scripts analytics
│   ├── src/               # Dashboard client-side
│   ├── scripts/           # Script Node per snapshot → SQLite
│   ├── data/              # SQLite archive (gitignorato, contiene dati IG)
│   ├── public/            # Brand assets
│   └── CLAUDE.md          # Documentazione operativa dettagliata
└── README.md              # Questo file
```

La documentazione approfondita sta in [ig-dashboard/CLAUDE.md](ig-dashboard/CLAUDE.md): architettura, flusso di fetch, schema DB, script analytics, decisioni di design, limiti noti.

## Quick start

```bash
cd ig-dashboard
cp src/config.example.js src/config.js
# modifica src/config.js e metti il tuo Page access token
npm install
npm run init-db      # crea data/pulp.db
npm run dev          # apre il dashboard su localhost:5180
npm run snapshot     # cattura un punto storico in SQLite
```

Con `TOKEN = ""` il dashboard gira in **demo mode** con dati fake — utile per iterare sulla UI senza token.

## Stato

- ✅ Dashboard live con reach chart, content mix, scatter plot, heatmap, audience, delta vs periodo precedente
- ✅ Demo mode con dati generati deterministicamente
- ✅ Archivio SQLite con schema (`daily_snapshot`, `post`, `post_snapshot`, `audience_snapshot`, `run_log`, `meta`)
- ✅ Script `npm run snapshot` per popolare il DB
- 🔜 Scheduling automatico (Task Scheduler locale o cloud)
- 🔜 Briefing settimanale via Gmail MCP
- 🔜 Post-mortem on-demand
- 🔜 Editor piano editoriale basato su storico

## Segreti

Il Page access token vive in `ig-dashboard/src/config.js` che è **gitignorato**. Su GitHub finisce solo `config.example.js` con placeholder. Il DB locale `ig-dashboard/data/pulp.db` è anch'esso gitignorato perché contiene dati IG reali.

Per maggiori dettagli su generazione token, permessi richiesti, architettura dei fetch e roadmap: [ig-dashboard/CLAUDE.md](ig-dashboard/CLAUDE.md).
