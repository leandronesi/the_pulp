---
name: pulp-briefing
description: Genera briefing settimanali/mensili sui dati Instagram di The Pulp leggendo da Turso. Produce un markdown analitico in italiano, nel tono del brand, con delta vs periodo precedente, hero/bottom post, pattern osservati e azioni consigliate. Adatta dalla skill social-media-analyzer di alirezarezvani (struttura a 7 step) e dal pattern "skill.md come source of truth" proposto da Stormy AI.
---

# Pulp · Briefing

## Quando invocare questa skill

Quando l'utente chiede uno di questi:
- "Fammi il briefing settimanale" / "briefing mensile"
- "Report della scorsa settimana"
- "Come stiamo andando?" con contesto dati-IG
- Post-mortem comparativo di un periodo vs precedente

## Cosa produce

Un file markdown in `reports/briefing-YYYY-MM-DD.md` (o output diretto in chat) con questa struttura fissa:

```markdown
# The Pulp · Briefing [settimanale|mensile] · [data inizio]–[data fine]

## Headline
[1-2 frasi: la cosa più importante del periodo]

## Numeri
- Reach: X ([+/-]Y% vs periodo prec. · tier: [excellent|good|avg|poor])
- Engagement rate: X% ([+/-]Y pp vs prec. · tier)
- Accounts engaged: X ([+/-]Y%)
- Follower: X (netti: +/- N)
- Post pubblicati: N

## Hero del periodo
[Post top per reach|ER, con analisi 2-4 righe: perché ha funzionato,
 cosa aveva di diverso rispetto alla media, in che slot/tipo/caption]

## Sotto-media
[Post bottom, stessa lunghezza, focus su cosa può essere la causa]

## Pattern osservati
- [3-5 bullet concisi: orari che convertono di più, formato vincente,
   audience in movimento, trend di crescita dei post nel tempo (usare i
   post_snapshot per la curva), ecc.]

## Azioni per il prossimo periodo
1. [Azione concreta con motivazione dati-driven]
2. ...
3. ...
```

## Workflow in 7 step

Ispirato a social-media-analyzer di alirezarezvani, ma customizzato sul data model di The Pulp (schema SQLite in `references/schema.md`).

### Step 1 — Validate data availability
Query: `SELECT MIN(date), MAX(date), COUNT(*) FROM daily_snapshot WHERE date BETWEEN ? AND ?`.
Se meno di 3 snapshot nel periodo richiesto → rispondi all'utente che i dati non sono sufficienti e proponi di aspettare qualche giorno in più. Non inventare numeri.

### Step 2 — Current period aggregates
- Totali periodo: `SUM(total_interactions)`, `AVG(followers_count last - first)`, `AVG(reach)` su `daily_snapshot`.
- ER period: `SUM(total_interactions) / SUM(reach) * 100`.
- Post del periodo: i post con `timestamp` nel range, con la loro ultima metrica nota da `post_snapshot`.

### Step 3 — Previous period aggregates (same length)
Stesso calcolo su `[since - length, since]`.

### Step 4 — Identify outliers
- **Hero**: post con il reach più alto del periodo (oppure ER più alto se non-seguono-ranking-per-reach).
- **Bottom**: post con ER più basso tra quelli con almeno 200 reach (evita di penalizzare post con reach=5 per rumore).
- **Anomalie temporali**: giorni in cui il reach è >2σ sopra/sotto la media del periodo. Questi vanno citati nei "pattern".

### Step 5 — Benchmark
Usa i tier di `references/benchmarks.md`:
- ER <1% → poor, 1-3% → avg, 3-6% → good, >6% → excellent.
- Follower growth netto settimanale: <0.2% → concerning, 0.2-0.5% → flat, 0.5-1% → good, >1% → excellent.
- Mai dichiarare "sei in tier X" senza aver fatto il calcolo. Mai confondere il reach assoluto coi tier (i tier sono relativi).

### Step 6 — Brand voice synthesis
Leggi `references/brand-context.md`. Regole base:
- **Italiano**, tono editoriale ma diretto. Niente corporatese, niente esclamativi, niente emoji (salvo richiesta esplicita).
- Frasi medio-corte con trattini per dare ritmo ("Reach in calo — ma era atteso, la settimana di pausa…").
- Citare il contesto del post (caption reale, tema, format) non solo le metriche nude.
- Evitare cliché di marketing ("engagement skyrocketing", "performance outstanding"). Preferire lingua concreta e italiana.

### Step 7 — Draft report
Assembla il markdown seguendo il template sopra. Se il briefing verrà inviato via email (Gmail MCP), aggiungi una riga vuota prima di `# The Pulp`. Per salvataggio su file: path `reports/briefing-<YYYY-MM-DD>.md` (data del lunedì del periodo coperto per i settimanali, primo del mese per i mensili).

## Regole operative

- **Human-in-the-loop sempre**: il briefing è un **draft** per l'utente, mai auto-inviato senza review (lezione da Stormy AI). Anche se in futuro ci sarà un cron, il cron produce il draft e notifica, non pubblica.
- **Non inventare numeri**: se una query torna `null`, metti `—` nel briefing e nota il gap. Meglio un briefing con buchi dichiarati che un briefing fittizio.
- **Richiama sempre il post concreto**: "il reel del 17/4 su Monteforte al tramonto" è mille volte meglio di "un contenuto recente".
- **Comparazione periodo prec. sempre stessa lunghezza**: 7d vs 7d precedenti, 30d vs 30d precedenti. Mai mescolare scale.
- **Cita il limite quando il campione è piccolo**: se ci sono 2 post nel periodo, non tirare pattern forti — dichiara il sample size nelle Note.

## Riferimenti

- [references/schema.md](references/schema.md) — Schema SQLite (tabelle, colonne, indici, chiavi)
- [references/brand-context.md](references/brand-context.md) — Identità, audience, tone of voice di The Pulp
- [references/benchmarks.md](references/benchmarks.md) — Tier IG (ER, reach per follower, growth rate)

## Implementazione futura

`scripts/briefing.js` (non ancora scritto) automatizzerà il workflow: parametri `--period weekly|monthly --output file|stdout|email`. Il cron via GitHub Actions genererà il draft ogni lunedì 8:00 IT e lo invierà via Gmail MCP all'utente. Per ora questa skill è usata in modalità interattiva: l'utente chiede, Claude esegue i 7 step manualmente interrogando Turso.
