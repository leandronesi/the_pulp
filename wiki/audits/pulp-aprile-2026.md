# Audit — The Pulp · Aprile 2026

Pattern strutturali emersi dal report mensile. Il report con i numeri grezzi vive in [reports/aprile-2026.md](../../reports/aprile-2026.md) ed è gitignored. Qui restano solo le **inferenze ripetibili**, utili come baseline per i mesi successivi.

## Stato del progetto al 01/05/2026

- Fase: **Lancio** (~56 giorni dalla ripartenza del 6/3, 22 post post-pausa)
- Follower: 475 (era 474 al 24/4)
- Identità editoriale: stabilizzata. Caption ad aprile mediana 920 char (vs 210 nel mix totale storico), 0% caption vuote, 40% con domanda
- Audience: 58% F · 71% fascia 25-44 · 67% Roma · 98% Italia
- Cadenza aprile: 2.33 post/sett, ER medio 6.25%, R/F medio 289%

## Pattern duraturi identificati

### 1. Il funnel di conversione, non la copertura, è il vero bottleneck

The Pulp ha un **problema di conversione** (reach → follow), **non un problema di reach**. 6 post su 10 ad aprile hanno R/F > 200% — l'algoritmo IG sta già spingendo bene contro i 475 follower. Il numero che resta fermo è il follower count.

Stima conversione attuale: ~0.05-0.1% reach-non-follower → follow.
Tier *good* per micro-account culturali/editoriali: 0.3-0.5%.

**Implicazione operativa**: i contenuti in più non risolvono. Risolvono:
- bio che promette (non solo descrive)
- CTA "follow" esplicita nei post
- highlight permanenti (Manifesto, Episodi, Eventi, Backstage)
- primo commento dell'account dopo ogni post per estendere la caption

### 2. Il ritmo è la leva primaria del reach mensile

Buco di 13 giorni 10-22 apr (1 solo post) → -22% reach totale mese vs marzo, a parità di qualità per-post. Sotto 1.000 follower l'algoritmo IG decadica rapidamente l'account in silenzio.

**Soglia operativa**: niente buchi sopra 5 giorni. 2 post a settimana costanti > 4 post in 3 giorni e poi vuoto.

### 3. Le caption Pulp si stanno allungando — e in parte è un debito

Lunghezza mediana caption: 210 char (storico totale) → 920 char (aprile). La voce è più editoriale ma:
- 0% CTA esplicita ad aprile (era 20% nel totale)
- 0% caption vuote (era 15%)

La densità testuale non si traduce automaticamente in attivazione. La caption lunga senza domanda finale resta dichiarazione unidirezionale. Da chiudere ogni testo lungo con un gancio attivo.

### 4. Saved come metrica di qualità sotto-tier

Pulp aprile: 13 saved totali su 10 post (1.3/post · save-rate ~0.7%).
Tier desiderabile per micro-account: ≥ 2% save-rate.

Cause probabili: il content mix è prevalentemente manifesto + ironia + citazione. Manca la categoria "consultabile" (liste, mappe, mini-guide, ricette). I saved richiedono contenuti che la persona vuole **rileggere**.

### 5. Stories come canale presente ma irregolare

19 stories in 7 giorni (24-30/4): reach medio 99 (~21% follower attivi), reply rate 0.64%, top story con 15 shares su 121 reach.

Distribuzione irregolare (5 il 25/4, 1 il 26 e 29). Pattern da uniformare: 3-5 stories/giorno costanti.

### 6. La community è romana, adulta, femminile — e non si muove con un mese di volume

Audience stabile 24→30 apr. Ogni shift (es. +1 milanese) è statisticamente irrilevante in 7 giorni. La verifica significativa di drift demografico è 60-90 giorni.

**Implicazione**: per testare se contenuto X "porta audience milanese", serve 2 mesi di esecuzione costante di X, non 2 settimane.

## Cosa fare diverso a maggio

Vedi [reports/aprile-2026.md §10](../../reports/aprile-2026.md). Le 5 azioni con misura:

1. Chiudere ogni gap > 4 giorni (target: gap mediano ≤ 3.0gg, reach mese ≥ 14.500)
2. CTA finale a 7 post su 10 (target: ≥ 9 commenti/post)
3. Bio + 4 highlight permanenti (target: +15-25 follower)
4. Hashtag locali 5-8/post + 1 tag/post (target: shares ≥ 22/post)
5. 2 carousel "saved-bait" formato lista (target: saved totali mese ≥ 25)

## Verifica per giugno

A fine maggio rileggere questo audit e:
- Confermare/falsificare le 5 azioni con i dati reali
- Aggiornare il funnel di conversione stimato
- Decidere se il pattern saved-bait è effettivamente leva o no
- Audit shift Milano: passa da 8 a 12+? Se sì, c'è un canale fuori dal Lazio aperto.

## Riferimenti

- Skill brand context: [.claude/skills/pulp-briefing/references/brand-context.md](../../.claude/skills/pulp-briefing/references/brand-context.md)
- Benchmark IG: [.claude/skills/pulp-briefing/references/benchmarks.md](../../.claude/skills/pulp-briefing/references/benchmarks.md)
- Audit precedente (24/4): [pulp-audience-2026-04-24.md](pulp-audience-2026-04-24.md)
- Deep report 26/4 (sample post-ripartenza): `reports/deep-2026-04-26.md` (gitignored)
