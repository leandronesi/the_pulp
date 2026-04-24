# Cosa ci dà l'archivio Turso (stato al 2026-04-24)

Questo documento risponde a una domanda legittima: *"ok, abbiamo tirato su tutto sto sistema di snapshot e DB cloud — ma alla fine cosa ci sblocca che non potevo già vedere nell'app IG?"*.

La risposta breve: **la dimensione temporale**. La Graph API di Instagram risponde a domande tipo *"qual è il reach del post X oggi?"* ma è cieca su *"com'è cresciuto nel tempo?"* e *"il tuo account migliora da tre mesi a questa parte?"*. L'archivio Turso riempie quel buco.

---

## Cosa registriamo (oggi, automatico)

| Quando | Cosa | Frequenza |
|---|---|---|
| **Daily full** (cron 22:00 UTC) | Tutto: profilo, totali giorno, 30 post + insights, audience | 1 volta/giorno |
| **Fresh only** (cron ogni 4h :05) | Solo i post degli ultimi 7gg (le loro metriche correnti) | 6 volte/giorno |
| **Publish dashboard** (cron ogni 4h :15) | Pre-render data.json per il sito pubblico | 6 volte/giorno |

Le tabelle Turso che si riempiono:

- `daily_snapshot` — 1 riga/giorno: follower count, 5 metriche macro del giorno (reach, profile_views, website_clicks, accounts_engaged, total_interactions), media_count
- `post` — 1 riga/post: metadata stabile (caption, timestamp, media_type, permalink)
- `post_snapshot` — **N righe/post nel tempo** (chiave `(post_id, fetched_at)`): una fotografia delle metriche del post ogni 4h per i primi 7gg, poi 1/giorno. Questa è la tabella chiave: ricostruisce la curva di crescita
- `audience_snapshot` — 1 riga/(data × breakdown × key): demographics lifetime (gender/age/city/country) catturati daily
- `run_log` — telemetria delle esecuzioni cron
- `meta` — cache KV (es. ig_user_id)

## Quello che la Graph API NON ti dà (e Turso sì)

### 1. Follower growth nel tempo

Graph API ti dà solo `followers_count` corrente. Zero storia. Non puoi dire *"il 15 marzo avevi 430 follower e oggi 474, quindi hai fatto +44 in 40 giorni"* — a meno che tu non abbia salvato i dati il 15 marzo.

Turso: `SELECT date, followers_count FROM daily_snapshot ORDER BY date` → lista completa.

### 2. Curva di crescita di un post

Graph API ti dà il reach corrente di un post. Non ti dice *"questo reel ha fatto 500 reach nelle prime 2 ore, 1.2K a 24h, 2.5K a 72h, poi plateau"*.

Turso: `SELECT fetched_at, reach FROM post_snapshot WHERE post_id = X ORDER BY fetched_at` → ogni punto sulla curva.

Implicazioni pratiche:
- **Velocity iniziale**: "quanti reach/ora nelle prime 24h?" → distingue i post che esplodono subito vs quelli che salgono piano
- **Moment of death**: quando il delta reach → 0, il post ha finito di correre. Orizzonte utile per il planning editoriale
- **Late virality detection**: post vecchio >7gg che improvvisamente cresce → qualcuno l'ha rilanciato, o l'algo l'ha ri-spinto

### 3. Confronto settimana-su-settimana (o mese-su-mese) sui totali

Graph API ha `total_value` sul range, ma con limiti di finestra (30gg sulle metriche daily). Comunque non confronta mai due periodi automaticamente.

Turso + app: *"engagement rate questa settimana vs settimana scorsa?"* diretto via query.

### 4. Evoluzione del content mix

Il mix (Reels vs Carousel vs Foto) cambia mese per mese. Con Turso possiamo dire *"a febbraio eri 60% reel, a marzo 40% — e la reach è scesa del X% in quel periodo"*. Correlazioni che pre-archivio erano aneddoto.

### 5. Shift audience demografica

Quando avremo ≥2 `audience_snapshot` di date diverse (cioè tra ~2 giorni dalla messa in moto): possiamo vedere se le percentuali di gender/age/city si spostano nel tempo. Milano in crescita vs Roma stabile, per esempio.

### 6. Detezione anomalie

Con una serie temporale possiamo calcolare deviazioni standard. *"Il reach giornaliero è a -2σ dalla media degli ultimi 30gg, anomalia da indagare."* — una sentinella anziché un'occhiata visiva.

## Cosa NON unlocka l'archivio (onestà)

- **Storico pre-archivio**: i dati di marzo 2026 non li abbiamo, punto. L'archivio parte dal 24 aprile.
- **Dati lifetime non fotografati**: audience demografia è lifetime (non cambia per giorno, è il cumulo), quindi lo snapshot di ogni giorno la sovrascrive. Non abbiamo "audience al 15 aprile".
- **Metriche che Meta non espone affatto**: saves per-stories, click su singoli link in bio, ecc. Se Meta non lo dà, Turso non può salvarlo.

## Stato attuale (2026-04-24, ore 19)

- **Giorni raccolti**: 1 (oggi). Serve il primo cron daily delle 22 UTC per avere il secondo punto.
- **Post snapshot**: ~60 (2 manuali di oggi × 30 post). Già abbastanza per vedere sparkline nei PostCard.
- **Audience snapshot**: 1 breakdown lifetime (62 righe, da oggi).

## Valore nel tempo

| Dopo | Cosa puoi chiedere |
|---|---|
| **7 giorni** | Prima comparazione settimana-su-settimana. Curve di crescita post affidabili. |
| **30 giorni** | Trend mensile. Variabilità (σ) calcolabile. Shift audience leggero. |
| **3 mesi** | Stagionalità (pause, picchi). Pattern per media_type robusti. |
| **6 mesi** | Forecast basico su trend. Correlazioni tra cadenza posting e growth. |
| **12 mesi** | Anno-su-anno comparabili. L'archivio vale quanto un anno di social insights professionali. |

L'archivio è un investimento a tasso composto: all'inizio vale poco, poi vale sempre di più.

## Come consultarlo ora

1. **Dashboard tab Storico** (prossimo a cui sto lavorando): UI dedicata che mostra follower trend + post velocity table + cosa sblocca
2. **Chat "Chiedi al Pulp"** in dev: fa già query ad hoc su Turso via function calling. Prova *"mostrami la curva di reach del post più recente"* o *"quali post sono cresciuti di più ieri"*
3. **`scripts/briefing.js`**: genera un briefing markdown per un periodo specifico. Ora va già usando Turso + OpenAI per l'analisi
4. **Query diretta**: `sqlite3`-like tool o via CLI Turso per analisi una tantum

## Riferimenti

- [architecture.md](architecture.md) — layout completo dei 3 layer (dashboard / archivio / analista)
- [decisions/001-turso-storage.md](decisions/001-turso-storage.md) — perché Turso
- [decisions/002-fresh-vs-full-snapshot.md](decisions/002-fresh-vs-full-snapshot.md) — split cadenza cron
- [concepts/post-growth-curve.md](concepts/post-growth-curve.md) — come il modello `post_snapshot` registra la crescita
- [concepts/reach-deduplication.md](concepts/reach-deduplication.md) — perché la somma non torna (importante per interpretare trend)
