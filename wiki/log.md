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

## [2026-05-13] fix | Totali sempre da daily_snapshot + clamp coverage DB

Versione finale dopo round di iterazione con l'utente. Il vincolo è "i numeri devono tornare sempre e il custom deve poter andare indietro fino a dove abbiamo dati":

- **Politica unica per i totali**: somma `daily_snapshot` da Turso, identico metodo per 7g / 30g / custom. Niente più Graph API `total_value` mescolato con `computeTotalsFromDaily`: davano due metriche diverse (unique cross-day vs account-giorni cumulati) e creavano la discontinuità di scala che l'utente ha colto al passaggio 30→90g.
- **Clamp doppio**: `sinceUnix = max(richiesto, restartUnix, firstDailyUnix)`. Banner unico "finestra effettiva: dal DD MMM · Ng di REQg · l'account ha ripreso il X / i daily snapshot partono da qui".
- **Label cumulato**: card "Reach (cumulato)" quando viene da daily-sum (sempre, in pratica), tooltip che spiega chiaramente "ogni giorno conta i suoi unique 24h, chi ti vede in più giorni viene contato più volte". Pill "% dei follower" nascosto sul cumulato (sforerebbe 1000% su finestre lunghe).
- **export-json.js**: `RANGES = []` (era `[7, 30]`), niente più ranges precomputed via Graph API nel `data.json`. Il dashboard usa `data.followerTrend` (`daily_snapshot` archive) per qualunque finestra.
- **Onesti su cosa abbiamo**: ogni `daily_snapshot.reach` è generato da `rangeSinceUntil(1)` lato cron (finestra 24h rolling) → sommare giorni indipendenti non contamina con pre-DB. Quando il DB cresce, il custom si allarga automaticamente.

## [2026-05-13] fix | Niente totali stimati oltre 30g — onesto-vuoto > onesto-gonfio

Decisione di principio dopo aver visto i numeri:

- 7d reach=4.203 (Graph total_value, unique veri)
- 30d reach=7.684 (Graph total_value, unique veri)
- 90d reach=19.817 (chunking 3×28g + somma → doppi conteggi tra chunks)

Salto 30→90 di 2.6× non era un bug, era il limite onesto di Meta: il `total_value` accetta finestre ≤ 30g. Sopra dobbiamo spezzettare e sommare → lo stesso utente che ti vede in chunk-1 e chunk-2 viene contato due volte. Lo stesso vale per `computeTotalsFromDaily` su Turso (somma daily reach, account in 2 giorni conta 2).

Politica nuova: **niente numeri approssimati**. Meglio "—" che un numero gonfio.

- `RANGES = [7, 30]` in `export-json.js` (era `[7, 30, 90]`).
- DateRangeSelector: rimosso il chip 90d. Restano 7d, 30d, custom.
- App.jsx: per `span > 30g` (static o live), `totals = {}` e i KPI top mostrano "—" (il formatter già gestisce null/undefined). Disclaimer terracotta sotto l'header spiega perché.
- I post nella griglia + scatter restano visibili anche oltre 30g (filtrati per timestamp, non per totali aggregati).
- `daily.length` resta utile per la curva follower (segmento storico onesto), non per ricostruire reach mensile.

Quando avremo abbastanza storia per ricostruire unique cross-day (servirà cookie-level data, che IG non espone) potremo riconsiderare. Per ora niente fantasia.

## [2026-05-13] feat | Stories tab orientata al verdetto

Tab Stories: meno scaffold tecnico, più "cosa ti porti a casa".

- **Highlight rinominati**: "top del periodo" → "quella che ha attecchito" / "fondo del periodo" → "quella che è rimasta indietro". Più diretto del jargon analitico.
- **Verdetto qualitativo nelle highlight card**: invece di mostrare solo "X reach (1.4× la media)", la card sceglie il *perché* in base alle metriche dominanti — "5 DM ricevuti, gente che ti scrive in chat" / "3 condivisioni, l'hanno passata ad altri" / "reach 2.2× la media, l'algoritmo l'ha spinta" / "reactions a manetta, ha attivato la reazione veloce". Stessa logica per il bottom (niente interazioni → format poco coinvolgente).
- **StoryRow alleggerita**: prima 5 metriche sempre visibili (account unici · DM · navigazione · condivisioni · interazioni), ora 2 (account unici + DM, le due cose che contano davvero su micro-account) + un dettaglio espandibile `<details>"altri segnali"` quando ci sono shares/reactions non zero. Il drop-off resta solo se anomalo.
- **Rimosso il blocco didattico finale**: la legenda "KPI specifici stories" che spiegava reply rate / navigation / drop-off — ridondante con i tooltip già presenti. Riduce il rumore in fondo alla tab.

## [2026-05-13] fix | Restart-aware clamp, audience fallback Turso, tier stories non giudicanti

L'utente ha segnalato 5 punti, 3 codificati qui (gli altri 2 sono UI già toccata + discussione di prodotto su tab Stories):

**1. Clamp alla ripartenza dell'account.** Il dashboard mostrava ~20K reach sui 90gg, ma includeva ~22 giorni pre-rinascita (account dormiente dal giugno 2025 → marzo 2026, gap di 253g). Custom su marzo dava 0 perché Turso parte solo dal 23 aprile. Due metriche da fonti diverse (Graph API chunking vs Turso daily_snapshot) → numeri incoerenti per finestre antecedenti la ripartenza.

Soluzione: `detectRestart()` esportato in `analytics.js` (riusato anche da `report-deep.js`), chiamato lato `export-json.js` (server-side, server-side restart finisce nel `data.json`) e lato `App.jsx` (live mode). Quando l'utente seleziona una finestra che inizia prima di `restart_iso`, `sinceUnix` viene clampato e il `data.ranges[N]` precomputato accorcia le chiamate Graph. Banner gold sotto l'header mostra "finestra effettiva: dal DD mmm · Ng di REQg".

**2. Audience fallback Turso.** Il `/api/dev/history` ora include `audience` (latest snapshot da `audience_snapshot`). Quando Graph API live restituisce audience vuoto (errore silenzioso sotto soglia engagement, o range pre-rinascita), l'App fa fallback a quello Turso. In static mode `data.json` già include audience (server-side workflow): ridondante ma robusto.

**3. Stories tier copy.** "fiacca / media / forte" → "sotto media / in media / sopra media". Descrittivo, niente giudizi di valore.

## [2026-05-08] feat | Scatter "reel quality" — views × watch medio

Aggiunto secondo scatter sotto post analysis: solo reel del periodo con `video_view_total_time` non-null, asse X = views totali (latest), asse Y = watch medio per view (= vtt / views / 1000, secondi). Mediane come split → 4 quadranti:

- **hit** alte views / alto watch · cream — viral + ben fatto
- **scroll** alte views / basso watch · terracotta — arriva ma non trattiene
- **retained** basse views / alto watch · sage — capolavoro poco distribuito (rilancialo)
- **miss** basse views / basso watch · soft terra — né gancio né distribuzione

Outlier flag Tukey 1.5·IQR per evidenziare i hit veri. Sezione si nasconde sotto i 2 reel (split mediano senza senso). Tooltip dedicato `ReelWatchTooltip` mostra views/watch/tempo totale/quadrant.

`deriveReelWatchMeta(points)` in `src/analytics.js` riusa median/quantile esistenti.

## [2026-05-08] refactor | Coerenza Tempo/Views/Watch + Range >30g via DB + outlier tooltip

Tre fix consecutivi all'overview:

**1. Coerenza Tempo reel / Views / Watch medio.** Prima i tre numeri nella stessa rate strip non quadravano matematicamente tra loro:
- Tempo = somma DELTA `video_view_total_time` osservato nel periodo
- Views = somma views lifetime di tutti i video-like (REELS + VIDEO)
- Avg = media ARITMETICA degli `avg_watch_time` IG dei reel

Esempio reale (7g, 3 reel): tempo 16h29m, views 8.7K → tempo/views = 6.8s/view, ma il pill mostrava 9.5s (= media degli avg IG). I tre numeri non si parlavano e l'utente ragionevole faceva la divisione mentale e vedeva la discrepanza.

Ora uniformati a un solo modello — **lifetime sui reel pubblicati nel periodo**:
- Tempo = Σ `video_view_total_time` (latest snapshot) dei reel del periodo
- Views = Σ `views` (latest snapshot) DEGLI STESSI REEL (era REELS+VIDEO, ora REELS-only per coerenza)
- Avg = Tempo ÷ Views

Tradeoff accettato: persa la semantica "delta accumulato durante la finestra"; vinta la leggibilità delle tre metriche insieme. ADR 008 da rivedere quando si tocca.

**2. Range > 30 giorni.** Graph API `/insights` rifiuta `since/until` con span > 30g (errore #100 "There cannot be more than 30 days"). Prima il dashboard mostrava 6 metriche con errori sulla card di warning. Ora: sopra soglia salta le chiamate Graph e ricomputa totali + reach daily da `daily_snapshot` di Turso (caricato via `/api/dev/history` in dev, già pre-renderizzato in `data.json` in prod). Il sum-of-daily è approssimato per reach (uniqueness mensile reale ≠ Σ daily) ma è quello che la Graph API stessa farebbe; meglio approssimato che vuoto.

**3. ScatterTooltip outlier monco.** L'overlay `scatterOutliers` esportava solo `{x,y,z,id}` — quindi quando hoveravi sul reel-outlier (badge "OUTLIER") il tooltip riceveva un payload privo di data, caption, thumbnail, velocity, quadrant. Il layer base sotto aveva tutto ma l'outlier overlay intercettava l'hover. Allineato il payload con quello di `scatterByType`.

## [2026-05-08] refactor | Overview: KPI hero a 4 (no Video), Views nella rate strip, curva follower filtrata, ScatterTooltip robusto

Tre fix all'overview:

1. **KPI hero**: rimossa la card "Video" (formato in disuso su IG 2026, era rumore). Prima riga ora a 4 card: Follower · Reels · Carousel · Foto.
2. **Rate strip**: aggiunta card "Views" come 5° tile — `Σ views` dei contenuti video (Reels + Video feed) nel periodo, con delta vs periodo precedente. Riga ora a 5 card.
3. **Curva follower**: la sparkline nella KpiCard "Followers" ora rispetta il `dateRange` (prima mostrava sempre tutto lo storico, ignorando il filtro). Il "live" in coda viene appeso solo se la finestra include oggi.
4. **ScatterTooltip**: nasconde data/quadrant/percentuali quando i dati sono mancanti (prima mostrava "Invalid Date" sui post senza timestamp valido + crashava se `d.y` era null).

## [2026-05-08] refactor | Fix watch time reel: ora rispetta il periodo

Bug nel KPI "Tempo totale visualizzazione reel" su [App.jsx](../ig-dashboard/src/App.jsx) (useMemo `reelTotalWatchMs`): il delta `lastObs - firstObs` ignorava il bound inferiore `sinceMs`. `firstObs` era sempre il primissimo snapshot esistente del reel, `lastObs` il più recente ≤ `untilMs`. Risultato: il numero non cambiava al variare del periodo selezionato (7/30/90gg).

Fix: introdotti `preBaseline` (ultimo snapshot con `t < sinceMs`, copre l'intera finestra) e `firstInPeriod` (fallback se la storia non arriva prima di `sinceMs`). Baseline = `preBaseline` se disponibile, altrimenti `firstInPeriod`. Coerente con il comment originale ("Niente baseline=0 inferita") e con l'intento documentato in ADR 008.

Ora il KPI cresce con il periodo come ci si aspetta. Sui range corti (7gg) il valore può ancora essere undercount finché non maturiamo abbastanza storia (~7 giorni di cron orario).

## [2026-05-03] note | Pitch deck nuovo + three-insights aprile

Per il momento "vado dai The Pulp e gli spiego la dashboard" servivano due artefatti che il `dashboard-intro.html` non copre, perché quello è scritto come **manuale tecnico** (15 slide che spiegano ogni feature):

1. **[docs/dashboard-pitch.html](../docs/dashboard-pitch.html)** — pitch caldo per pubblico non-numerico, 10 slide. Tono editoriale Pulp, niente jargon. Frame: "Una memoria per i vostri contenuti" (IG dimentica, noi no). Slide narrative: chi sono, problema IG, cos'è, grammatica 4 parole, 3 insight di aprile (vedono in tantissimi/follower fermi, smettete e algoritmo dimentica, voi vs manifesto), come si usa, chiusura. Ogni insight ha numero grande + claim italica + "mossa di maggio" con misura.

2. **[reports/aprile-2026-three-insights.md](../reports/aprile-2026-three-insights.md)** — distillazione iper-compatta del report mensile a 3 messaggi, formato leggibile in 90 secondi. Per quando si vuole "il messaggio" senza il numero di pagine del report pieno.

Il manuale tecnico [docs/dashboard-intro.html](../docs/dashboard-intro.html) resta ed è stato **allineato alla UI nuova** post-refactor 2026-05-03: slide 5 (Overview KPI) descrive ora 5 card volume per format + 4 card qualità (Reach/Tempo reel/Engagement post-based/Share rate, niente più Save rate); slide 8 (Content mix) menziona watch medio nella tile REELS; slide 9 (Stories) aggiornata a 2 KPI principali + reach giornaliero chart.

Pattern di separazione utile per il futuro: **pitch** (perché serve, valore) ≠ **manuale** (come funziona, ogni feature). Audience diverse, tono diverso, lunghezza diversa.

---

## [2026-05-03] refactor | Overview KPI riorganizzato + Stories semplificato

Feedback utente sui KPI delle prime due righe Overview e sulla tab Stories. Tre cambi principali:

1. **Overview · riga 1 (5 hero KPI)** ora è solo "volume per format": Followers + Reels (count) + Carousel + Video + Foto. La card Reels prima conteneva il pill `watch Xs` e la legenda watch tier — rimossi. La vecchia card "Tempo reel" è stata eliminata dalla riga 1.

2. **Overview · riga 2 (rate strip)** ora è: Reach · **Tempo reel** · **Engagement (post-based)** · Share rate. Rispetto a prima:
   - **Save rate rimosso**: su micro-account (<1k follower) il segnale è troppo zero-inflated per essere actionable in dashboard (a fine mese resta utile per analisi mensile, ma su 7g rumore puro). Il save rate resta calcolato in `postMetricsAgg` per chi lo voglia leggere via codice/briefing.
   - **Tempo reel spostato qui** dalla riga 1 — RateCard col tier `watchTimeTier` e legend pill, info testuale che cita il count reel pubblicati e la finestra osservata.
   - **Engagement ora è post-based**: `Σ(interactions post) / Σ(reach post) × 100`, calcolato in `postMetricsAgg.engagementRate`. Prima usava i daily_snapshot account-level (`totals.total_interactions / totals.reach`) che includono anche azioni profilo non legate ai contenuti del periodo. Il delta vs prec è calcolato in `postMetricsAggPrev` filtrando `posts` sul periodo `[since-rangeSec, since)`. Vecchi memo `engagementRate` / `engagementRatePrev` rimossi insieme agli import inutilizzati (`Bookmark`, `saveRateTier`).

3. **Stories tab semplificata**: 4 KPI tile → 2 (REACH MEDIO + INTERACTION RATE). Aggiunto **area chart "reach giornaliero stories"** sotto le tile, stesso pattern visivo del reach Overview (gradient cream + tooltip `count storie/giorno`). Rimossi NAVIGATION/REACH (segnale ambiguo, già discusso in tooltip dello story row) e REPLY RATE (assorbito dall'INTERACTION RATE che lo include). Il count stories e il reply rate restano visibili nell'insight bar narrativa e nelle strisciatine. `storyNavRateTier` import rimosso da stories.jsx.

**Razionale dietro l'ER post-based** ([reports/aprile-2026.md §4](../reports/aprile-2026.md)): aprile ha mostrato che il calcolo account-level può divergere dal segnale "contenuti pubblicati" quando i daily includono profile_views / website_clicks. Mostrare il numero che riflette esattamente i post del periodo è più utile per le decisioni editoriali e più stabile della media-delle-medie per-post (un post con reach piccolissimo non gonfia il numero).

Build OK ([dist/](../ig-dashboard/dist/)) · dev `:5180` up. Verifica visuale browser ancora da fare.

---

## [2026-05-01] audit | Primo report mensile (aprile 2026)

Primo deep dive a mano del progetto post-ripartenza, scritto come report mensile e non generato da `report-deep.js`. Output: [reports/aprile-2026.md](../reports/aprile-2026.md).

Pattern centrali emersi (calibrati su contesto micro-account romano <500 follower, fase Lancio):

1. **Reach altissimo, follower piatti**: 6 post su 10 ad aprile hanno R/F > 200%, ma la conversione visibilità→follow è ~0.05-0.1% (industry per il segmento sarebbe 0.3-0.5%). Il bottleneck non è l'algoritmo, è il funnel di profilo: bio descrittiva non promette, 0% CTA nei post, niente highlight permanenti.
2. **Il ritmo conta più della qualità**: aprile -22% reach mensile vs marzo è quasi interamente spiegato da un buco editoriale di 13 giorni (10-22 apr). Sotto i 1000 follower, l'algoritmo "spegne" velocemente account in silenzio.
3. **Saved -32% mese su mese**: il segnale che IG ranka di più è quello che cala di più. Pulp manca di formati "consultabili" (liste, mappe, mini-guide) — è prevalentemente manifesto + ironia. Da bilanciare a maggio.
4. **Audience stabilità**: F 58% / 25-44 71% / Roma 67% — invariata tra 24 e 30 aprile. Coerente con un mese di volume normale: l'audience non si sposta con 10 post.

Aggiunto script riusabile [ig-dashboard/scripts/analyst-dump.js](../ig-dashboard/scripts/analyst-dump.js) che dump-a Turso in `reports/raw-dump-YYYY-MM-DD.json` per analisti umani/AI. Comando: `npm run analyst:dump`.

Salvato anche audit dedicato in [wiki/audits/pulp-aprile-2026.md](audits/pulp-aprile-2026.md) con i pattern duraturi (non i numeri del singolo mese, ma le inferenze ripetibili).

---

## [2026-05-01] refactor | publish-dashboard cron 4h → orario

Mismatch di cadenza scoperto in conversazione: `snapshot-fresh` scriveva su Turso ogni ora ma `publish-dashboard` rigenerava `data.json` solo ogni 4h, quindi la dashboard pubblica vedeva i nuovi dati con ritardo fino a 4h. Cambiato cron in [.github/workflows/publish-dashboard.yml](../.github/workflows/publish-dashboard.yml) da `15 */4 * * *` a `15 * * * *` — sfasato di 10 min dopo lo snapshot fresh (`5 * * * *`). Repo public → GH Actions illimitato, nessun vincolo di costo.

Aggiornato anche il riferimento in [ig-dashboard/CLAUDE.md](../ig-dashboard/CLAUDE.md) sezione Deploy pubblico.

---

## [2026-04-29] refactor | Cron fresh orario + daily_snapshot upsert + fix off-by-one

Tre cambi correlati a [ADR 002](decisions/002-fresh-vs-full-snapshot.md) (sezione "Aggiornamento 2026-04-29"):

1. **Cron fresh: 4h → orario** ([.github/workflows/snapshot-fresh.yml](../.github/workflows/snapshot-fresh.yml)). Risoluzione 24 punti/giorno per i reel freschi (era 6) per leggere meglio il "moment of death" della curva. Repo public → GH Actions illimitato, free tier Turso/Meta ampiamente sotto i limiti (~0,04% writes Turso, ~6% Meta).
2. **Daily upsert orario** ([scripts/snapshot.js](../ig-dashboard/scripts/snapshot.js#L246-L304)). Il cron orario ora aggiorna anche `daily_snapshot` del giorno in corso (range mezzanotte Rome → ora). Helper nuovi `rangeTodaySoFarRome` + `rangeYesterdayRome` in [ig-fetch.js](../ig-dashboard/scripts/ig-fetch.js).
3. **Fix off-by-one su `daily_snapshot.date`**. Il daily cron a 00:00 Rome etichettava le righe con la data di run invece che con la data del periodo coperto (ieri). Fix: `yesterdayIsoDate()` per il daily, `todayIsoDate()` per l'orario. Migrazione retroattiva one-shot in [scripts/db.js](../ig-dashboard/scripts/db.js) protetta da flag `daily_date_offset_fix_v1` in tabella `meta`.

**Conseguenza per chi legge `daily_snapshot`** (briefing, deep report, follower trend, dashboard sparkline): la query `WHERE date='2026-04-26'` prima ritornava i dati del 25, ora ritorna quelli del 26. Eventuali report già generati hanno numeri giusti ma label off-by-one rispetto al codice nuovo.

---

## [2026-04-28] decision | Watch time per i reel catturato in `post_snapshot`

L'app IG ufficiale espone `tempo di visualizzazione` totale + medio per ogni reel (in `Insight sul reel`). Noi non li stavamo capturando — giudicavamo i reel solo via reach/ER/views, cieco rispetto a "il reel viene davvero guardato o passa nel feed".

Aggiunte 2 colonne nullable su `post_snapshot`: `video_view_total_time` + `avg_watch_time` (ms). Fetch dedicato per `media_product_type === "REELS"` in [ig-fetch.js#fetchReelInsights](../ig-dashboard/scripts/ig-fetch.js) (le `ig_reels_*` non possono stare nel batch insights embedded — farebbero fallire i carousel/image). Wiring in [snapshot.js#writePosts](../ig-dashboard/scripts/snapshot.js) con concurrency 8 (stesso pattern delle stories).

Costo: ~5 chiamate API extra al giorno (3-5 reel/settimana × 6 fresh run/giorno) — irrilevante rispetto al limite 200/ora.

ADR completa: [decisions/008-reel-watch-time.md](decisions/008-reel-watch-time.md). Display sul dashboard / deep report ancora TBD (la metrica è ora dietro le quinte, le decisioni di UI vengono dopo aver accumulato qualche giorno di curve).

---

## [2026-04-25] refactor | App.jsx modularizzato (2811 → 1628 righe)

App.jsx aveva superato i 2800 righe — il vincolo "monolitico finché non ingestibile" era stato passato (costo in token quando spawno Sonnet su task ristretti).

**Sprint orchestrato Opus → Sonnet × 5 paralleli**:
- Sprint 0 (Opus): estratti helper top-level in `src/utils/format.js` (fmt, fmtDate, delta, ...) e `src/utils/tiers.js` (erTier, reachRateTier, ..., MEDIA_TYPE_LABELS, POST_DOT_COLORS, costanti heatmap).
- Sprint 1-5 (5 Sonnet in parallelo): ognuno crea un file in `src/components/` senza modificare App.jsx. Output:
  - `tooltips.jsx` — InfoTip + DarkTooltip + ReachWithPostsTooltip + ScatterTooltip
  - `stories.jsx` — StoriesStrip + StoriesTab + StoryKpi + StoryRow + StoryMetric
  - `DateRangeSelector.jsx` — Radix Popover + DayPicker
  - `kpi-cards.jsx` — DeltaPill + RateCard + ReachTrio + KpiCard + SummaryRow + ContentMixStat + Sparkline (export per riuso)
  - `posts.jsx` — ContentTypeTile + LifecycleMiniChart + PostCard + Metric + AudiencePanel
- Fase 3 (Opus): integrazione manuale in App.jsx (imports + delete blocchi), pulizia degli import morti (rimossi createPortal, Popover, DayPicker, locale `it`, e 4 lucide icons), build verde.

Trappole risolte durante il refactor:
- `Sparkline` era usato sia da KpiCard sia da PostCard → un agente l'aveva duplicato come internal in kpi-cards.jsx. Fix: cambiato in `export function`, posts.jsx la importa da `./kpi-cards.jsx`.
- `ContentMixStat` stessa storia → tenuto in kpi-cards.jsx (è una "stat-tile" affine al gruppo), posts.jsx lo importa.

Pattern di lavoro convalidato (vedi memory globale `feedback_orchestrator_pattern.md`): Opus fa planning + integration + verify, Sonnet fa estrazione meccanica in parallelo. ROI immediato sui prossimi task — ora un Sonnet che modifica `StoriesTab` carica 298 righe invece di 2800.

---

## [2026-04-24] feat | Milestone 1 analytics: velocity, benchmark ratio, scatter quadrants, lifecycle cards

- Creato [ig-dashboard/src/analytics.js](../ig-dashboard/src/analytics.js) come modulo shared per:
  - benchmark per `media_type`
  - `derivePostAnalytics()` con `velocity7d`, `benchmarkRatio`, `benchmarkDeltaPct`, `lifecycleSeries`, `curveType`
  - `deriveScatterMeta()` con mediane reach/ER, quadranti e flag outlier
  - `deriveContentMix()` con velocity media e rapporto medio vs benchmark
- [scripts/export-json.js](../ig-dashboard/scripts/export-json.js) ora scrive anche `postAnalytics` nel payload statico. Obiettivo: spostare i derivati costosi fuori dal render e lasciare il client piu' leggero
- [src/App.jsx](../ig-dashboard/src/App.jsx) aggiornato per usare i derivati shared:
  - content mix con velocity media, delta vs benchmark e conteggio outlier per formato
  - scatter reach vs ER con `ReferenceLine` sulle mediane e ring highlight sugli outlier
  - sort mode `velocity`
  - post card con badge velocity / benchmark / curve type e mini timeline 7g `reach` + `saved`
- [src/fakeData.js](../ig-dashboard/src/fakeData.js) arricchito con curve diverse (`front_loaded`, `steady`, `slow_burn`) e boost occasionali per simulare outlier reali anche in demo mode
- Verifica:
  - `npm.cmd run build` OK (richiesta esecuzione fuori sandbox per limite `spawn EPERM` di esbuild in sandbox)
  - smoke test Node sui helper analytics + fake data OK (`posts=18`, `outliers=1`, `sampleCurve=front_loaded`)
- Guardrail rimasto fermo: niente clustering in questa iterazione; niente ECharts finche' Recharts regge senza workaround brutti

## [2026-04-24] note | Roadmap analytics vNext: 3 milestone + guardrail metodologici

- Formalizzata in `TODO.md` una roadmap a 3 milestone per l'evoluzione analytics del dashboard:
  1. **Performance & format signal** — `velocity`, benchmark di nicchia, scatter reach vs ER con quadranti/outlier, timeline 7 giorni per post
  2. **Temporal intelligence** — calendar heatmap con overlay engagement e lettura pattern settimanali/stagionali
  3. **Audience loyalty proxy** — coorti follower settimanali e stickiness proxy
- Guardrail deciso: **niente k-means su `media_type` puro**. Il clustering ha senso solo su feature numeriche standardizzate (`reach`, `ER`, `save/share rate`, `velocity`, publish hour); `media_type` resta overlay interpretativo
- Guardrail deciso: **niente claim di retention follower "vera"** con i dati attuali. Lo storage ha `daily_snapshot` e `audience_snapshot`, ma non eventi follower-level. Possiamo stimare crescita netta/coorti proxy, non retention persona-per-persona
- Scelta tecnica: mantenere **Recharts** per KPI e chart semplici; introdurre **Apache ECharts** solo dove serve davvero (scatter avanzato, calendar heatmap, annotazioni/outlier). Observable Plot resta opzione secondaria per viste analitiche/report
- Obiettivo di prodotto: spostare il dashboard da reporting descrittivo a strumento decisionale senza rompere la leggibilità attuale né gonfiare troppo `App.jsx`

## [2026-04-24] feat | Refactor IA: 3 tab (Overview/Posts/Audience) + fix date filter consistency + fallback 90d

**Phase 1 — Tab structure** (ADR 007 da scrivere)
- Installato `@radix-ui/react-tabs`. Tre tab al top level: Overview · Posts · Audience
- TabTrigger custom con underline cream animato, icone lucide (LayoutDashboard/Grid3x3/UsersRound)
- URL hash deep linking: `#overview`/`#posts`/`#audience`. F5 safe via stato in `window.location.hash` + listener hashchange
- Animazione fade 300ms tra tab tramite `data-[state=active]` + tailwindcss-animate-style classes
- Tab "Overview": hero KPIs + rate strip + reach chart + sintesi (lo "sguardo in 10 secondi")
- Tab "Posts": content mix + post analysis + heatmap (deep-dive contenuti)
- Tab "Audience": panels demographics con banner esplicito "lifetime — non cambia col date range"

**Phase 2 — Date filter consistency**
- Nuovo memo `postsInRange`: filtra `posts` per `timestamp ∈ [sinceUnix, untilUnix]`. Tutti i derivati (enrichedPosts, sortedPosts, scatterByType, contentMix, heatmap, postMetricsAgg) ora usano `postsInRange`
- Banner in testa al tab Posts: "N post · Xg · +M fuori range" con InfoTip che spiega il limite dei 30 post fetched
- Empty state quando il filtro taglia tutto: "Nessun post nel periodo" con icona + suggerimento di allargare il range
- **Fallback 90d** in `ig-fetch.js/fetchDayTotals`: per range > 30gg Meta ritorna null su total_value. Ora spezzetta il range in chunk da ~28gg e somma i singoli total_value. Non è deduplicato cross-chunk (un utente visto in chunk 1 e 2 conta 2) ma dà numeri robusti. Verificato: 90d ora ha reach=14590 interactions=2339 engaged=447 invece di null
- Array `fallbackUsed` ritornato al caller per eventuale segnalazione UX ("numero indicativo")

**Phase 3 — Polish**
- Empty state audience quando Meta blocca (sotto 100 follower engaged): icona UsersRound + spiegazione del perché
- Header audience col pill `lifetime` in gold + disclaimer chiaro

## [2026-04-24] fix | Layout rebalance: rate strip + chart flex-grow + reach trio
- Problema: Sintesi con 7 righe (save/share/views aggiunti) la rendeva molto alta, il reach chart panel si stretchava ma chart a `height={260}` fisso lasciava enorme vuoto sotto. Squilibrio visivo brutto.
- Fix:
  - **Rate strip**: nuova sezione a 4 colonne tra hero KPIs e reach+sintesi. Contiene Save rate, Share rate, Views video/reel, Account coinvolti (spostato da Sintesi). Tile compatti `RateCard` con tier pill visibile
  - **ReachTrio**: tre mini-stat (totale, media/giorno, picco con data) inline col titolo del reach chart → riempie lo spazio header e dà densità informativa
  - Chart panel diventa `flex flex-col` con chart in `<div className="flex-1 min-h-[260px]">` + ResponsiveContainer `height="100%"` → riempie lo spazio verticale fino all'altezza di Sintesi
  - Sintesi ridotta a 3 righe (Interazioni totali, Profile views, Website clicks condizionale) — rimossi Account coinvolti, save rate, share rate, views che ora vivono nella rate strip
- Risultato: altezze bilanciate, gerarchia metriche più chiara (hero → rate → chart/sintesi), niente più empty space enorme

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
