# CLAUDE.md — The Pulp workspace

Questo file viene letto automaticamente all'inizio di ogni sessione Claude Code in questa cartella. È **policy operativa** — il "come lavoriamo", non il "cosa c'è". I dettagli tecnici vivono altrove (vedi sezione 3).

> Convenzione di lettura: ogni riga sopra le ~200 entra in contesto. Tieni questo file conciso. Aggiungi dettagli nelle pagine linkate, non qui.

---

## 1. Identità

**The Pulp · Soave Sia il Vento** — account Instagram community romano, ~474 follower, focus editoriale-letterario. Il monorepo è un sistema **dashboard + archivio storico + analista AI** sui dati IG dell'account. Lingua di lavoro: **italiano**.

---

## 2. Pattern di collaborazione (regola n.1)

### 2.1 Orchestratore Opus → esecutori Sonnet

Quando l'utente chiede una **modifica non banale**, il flusso è:

1. **Analisi** (Opus): leggi le risorse rilevanti (sezione 3), inquadra il problema.
2. **Sprint plan** (Opus): definisci sotto-task self-contained.
3. **Spawn Sonnet** (Agent tool, paralleli quando indipendenti): ogni prompt include obiettivo, file precisi, vincoli, criteri di "fatto".
4. **Verifica** (Opus): leggi i diff con `git diff`, runna build/test, controlla coerenza con il sistema. *Trust but verify.*
5. **Sintesi + commit** (Opus): tu chiudi, l'agente non committa.

**Eccezioni — Opus diretto**: edit minimi (1 riga, fix typo, rename), letture/diagnosi, comandi di verifica (build, status), decisioni di design.

### 2.2 Decisività

Quando i dati passati dall'utente (token, endpoint, stack trace, screenshot) dichiarano già l'intento, **procedi senza chiedere conferma**. Le domande costano un round-trip e fanno perdere flow. Chiedi solo se: l'azione è distruttiva, o il path richiederebbe rewrite enormi di file non correlati.

### 2.3 Risposte esploratorie

Per domande tipo "che ne pensi?" o "potremmo fare X?": rispondi in 2-3 frasi con **una raccomandazione + il tradeoff principale**. Niente piani lunghi finché l'utente non conferma.

### 2.4 Comunicazione

- **Italiano sempre** (UI, commit, commenti script, briefing, report, conversazione).
- **Conciso**: riferisci risultati, non commentari di processo. Una frase di update quando trovi qualcosa, cambi direzione, blocchi.
- **Niente emoji** (a meno che l'utente non li chieda esplicitamente).
- **Niente marketing-speak inglese** ("performance", "engagement skyrocketing"); preferisci italiano concreto.

---

## 3. Cosa leggere PRIMA di rispondere

Gerarchia di consultazione, in ordine di precedenza:

| Risorsa | Quando |
|---|---|
| **[wiki/index.md](wiki/index.md)** | Sempre. Catalogo di ADR + concetti + audit. Pattern Karpathy: la knowledge non si rigenera, si stratifica qui. |
| **[TODO.md](TODO.md)** | Prima di proporre nuove direzioni — guarda cosa c'è in flight, cosa è già fatto, le priorità correnti. |
| **[wiki/log.md](wiki/log.md)** | Per capire cronologicamente cosa è cambiato di recente. |
| **[ig-dashboard/CLAUDE.md](ig-dashboard/CLAUDE.md)** | Quando tocchi codice del sub-progetto. Schema autoritativo per architettura, stack, convenzioni tecniche, palette, flusso di fetch. |
| **[.claude/skills/](.claude/skills/)** | Quando il task matcha il description di una skill (briefing, deep report, frontend design, ui-ux). |

### 3.1 Wiki: append, non sostituzione

Quando prendi una decisione non-banale: **append una entry in `wiki/log.md`** + eventualmente nuova ADR in `wiki/decisions/NNN-titolo.md`. Quando un briefing fa emergere un pattern: salvalo in `wiki/audits/`. Non rigenerare conoscenza che esiste già — leggi e stratifica.

---

## 4. Convenzioni meta

### 4.1 Git

- **Commit message in italiano**, breve titolo + dettagli sul perché (non sul cosa). Trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` quando fattibile.
- **Mai `git push` o `git push --force` senza consenso esplicito** dell'utente nella stessa conversazione. L'autorizzazione vale per quel push, non per i successivi.
- **Mai `--no-verify`** sui hook. Se un hook fallisce, investiga la causa.
- **Crea nuovi commit, non `--amend`** salvo richiesta esplicita.
- **Stage file specifici** (`git add path/file`) non `git add -A` — evita di committare per sbaglio config locali, .env, db.

### 4.2 Gitignore policy

I file con dati IG reali NON vanno committati: `**/data/*.db`, `ig-dashboard/public/data.json` (pre-renderato dal workflow), `reports/`, `ig-dashboard/src/config.js` (token), `.env`. Tutto già nel `.gitignore`. Non aggiungere file generati al repo "per comodità".

### 4.3 Output di lavoro

- **Report e briefing** vanno in `reports/` (gitignored). Mai committare un briefing — contiene caption reali e analisi.
- **Niente file .md di stato** ("piano.md", "analisi.md") creati per appunti di sessione. Lavora in conversazione, salva solo quando il risultato è valore durevole (→ wiki, ADR, audit).

---

## 5. Guardrail — cose da NON fare mai

- **Pushare senza consenso esplicito** della stessa conversazione (vale per ogni push, non c'è autorizzazione standing).
- **Modificare/leggere/loggare contenuti di `src/config.js` o `.env`** — contengono token. Mai includerli in commit, in messaggi all'utente, in payload LLM.
- **Inventare URL** o citare endpoint non documentati. Se serve un link, attinge da risorse del progetto o chiedi.
- **Generare riassunti che ripetono il diff** — l'utente vede già il diff. Riferisci decisioni non-ovvie e cosa è cambiato a livello concettuale.
- **Trattare l'account come "vivo dal 2025"** quando c'è stato un buco lungo. La fase attuale (post-ripartenza) è quella che conta. Vedi `report-deep.js` (detectRestart).
- **Bypassare demo mode**: `TOKEN=""` in `config.js` deve continuare a far girare il dashboard con dati fake.

---

## 6. Comandi cheat-sheet

Tutti da `ig-dashboard/`:

```bash
npm run dev               # dashboard live (Graph API), :5180
npm run snapshot          # snapshot full → Turso (1× al giorno via cron)
npm run snapshot:fresh    # snapshot incrementale ogni 4h: post recenti + stories
npm run briefing          # briefing settimanale → reports/briefing-YYYY-MM-DD-Nd.md
npm run report:deep       # fotografia analitica completa → reports/deep-YYYY-MM-DD.md
npm run export-json       # rigenera public/data.json per il deploy statico
npm run build             # build produzione (per deploy)
```

Cron remoti su GitHub Actions in [.github/workflows/](.github/workflows/) — gira tutto headless senza il PC acceso.

---

## 7. Skill disponibili

Trigger automatico quando il task matcha la `description`:

- **`pulp-briefing`** — briefing settimanale/mensile in italiano col brand voice.
- **`frontend-design`** (Anthropic) — qualunque modifica UI/styling/componenti React.
- **`ui-ux-pro-max`** — decisioni di design system (colori, font, palette, layout).

Riferimenti delle skill in [.claude/skills/](.claude/skills/). I file `SKILL.md` sono la source of truth per i workflow associati.

---

## 8. Definition of Done

Un task è "fatto" quando:

- [x] Codice modificato e committato (mai pushato senza consenso).
- [x] `npm run build` passa se hai toccato il dashboard.
- [x] Per UI/frontend: hai aperto `npm run dev` e verificato in browser, o detto chiaramente "non ho potuto testare visivamente".
- [x] Decisione non-banale → entry in `wiki/log.md` (e/o ADR in `wiki/decisions/`).
- [x] Risposta finale all'utente: 1-2 frasi di sintesi (cosa è cambiato, cosa è next), niente narrazione di processo.

---

## 9. Quando questo file deve essere aggiornato

- L'utente ti dà feedback su come collaborare ("non chiedere conferme", "sempre prima X poi Y") → aggiorna sezione 2.
- Cambia la struttura del repo (nuova sub-folder, skill, file di stato) → aggiorna sezioni 3 e 6.
- Si aggiunge un comando rilevante → sezione 6.
- Cambia una convenzione di commit/branch/release → sezione 4.

Tutto il resto (decisioni di design specifiche, schema DB, dettagli stack) **non sta qui** — sta in wiki o nei CLAUDE.md di sub-progetto.
