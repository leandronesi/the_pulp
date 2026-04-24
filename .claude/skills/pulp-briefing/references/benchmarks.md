# Benchmark Instagram — tier per i briefing

Fonti: media aggregata dai benchmark di settore (Social Insider, Rival IQ, Later, 2024-2026), incrociata con la skill [social-media-analyzer di alirezarezvani](https://github.com/alirezarezvani/claude-skills/blob/main/marketing-skill/social-media-analyzer/SKILL.md). Cifre da usare come guida, non come verità assoluta — l'IG benchmark varia per nicchia.

## Engagement Rate (ER) su reach

Formula: `(like + comment + saved + shares) / reach × 100`

| Tier | Soglia ER | Frase da usare nel briefing |
|---|---|---|
| **excellent** | > 6% | "in tier eccellente per IG" |
| **good** | 3 – 6% | "tier buono, in linea con account attivi di nicchia" |
| **average** | 1 – 3% | "tier medio, c'è margine" |
| **poor** | < 1% | "tier basso, vale indagare il perché" |

Nota: ER su reach è più severo di ER su follower. Per account piccoli (<1000 follower) il reach include spesso molti non-follower → ER naturalmente più basso. Tenere conto.

## Reach-to-follower ratio (per post)

Formula: `reach / followers × 100` per il singolo post.

| Tier | Soglia | Note |
|---|---|---|
| **viral** | > 100% | Il post ha raggiunto più del totale follower (arriva a non-follower via esplora/reels) |
| **strong** | 30 – 100% | Copertura ampia anche tra non-follower |
| **normal** | 10 – 30% | Tipico per contenuto medio |
| **low reach** | < 10% | Solo una frazione dei follower l'ha visto, possibile problema di timing/format |

## Follower growth settimanale

Formula: `(follower_fine - follower_inizio) / follower_inizio × 100`

| Tier | Soglia settimanale | |
|---|---|---|
| **excellent** | > 1% | Per un account da 500, è +5+/settimana |
| **good** | 0.5 – 1% | |
| **flat** | 0.2 – 0.5% | Non morto, ma non accelera |
| **stagnant / concerning** | < 0.2% | Se persiste 3+ settimane, c'è qualcosa |

Mensile: moltiplica i tier per ~4 (quindi >4%/mese = excellent).

## Per tipo di contenuto (IG 2026)

Reach medio atteso relativo (Reels > Carousel > Image > Video-feed, dai trend recenti):

| Media type | Reach atteso vs media account | Note |
|---|---|---|
| **REELS** | 1.5× – 3× | L'algo li spinge, soprattutto se tenuti brevi (<30s) |
| **CAROUSEL_ALBUM** | 1.1× – 1.5× | I più engaged per ER (saved e shares alti) |
| **IMAGE** | 0.7× – 1.0× | Baseline |
| **VIDEO** (feed) | 0.5× – 0.8× | Penalizzato dall'algo in favore dei Reels |

Se un media type performa fuori da questi range (es. Reels a 0.6× della media), è un segnale: ci sta qualcosa di non usuale nei reels dell'account (hook, lunghezza, audio).

## Orari best for posting (linee generali)

Non esiste un "best time" universale. Per il briefing di The Pulp, usa sempre la **heatmap reale** (reach medio per giorno×ora dagli ultimi 30-90gg) invece di benchmark generici. La heatmap è in `App.jsx` e deriva da `post.timestamp` + reach di `post_snapshot`.

Come riferimento-di-secondaria:
- Lun-Ven 19:00-21:00 (CET) → fascia "dopo cena", storicamente forte per food/wine/lifestyle
- Weekend 10:00-12:00 → "colazione lenta"
- Evitare Lun mattina (<8:00) e Dom sera tardi (>22:30)

Ma: sono medie di settore. Il dato di The Pulp **sul proprio storico** pesa 10× più del benchmark.

## Pitfall da evitare nelle recommendation

- Non paragonare il reach assoluto di un account da 500 follower con quello di un account da 50k. I tier sono relativi e gestiscono questo.
- Non dichiarare un post "virale" sotto il 100% di reach/follower.
- Un singolo post in tier "excellent" non rende "excellent" il periodo. Il tier si applica alla media del periodo.
- ER calcolato su campione < 3 post è statisticamente rumoroso — dichiararlo.
