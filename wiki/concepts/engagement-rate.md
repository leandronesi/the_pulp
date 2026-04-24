# Concept — Engagement Rate (ER)

## Definizione operativa per The Pulp

```
ER = (like + comment + saved + shares) / reach × 100
```

Dove tutti i valori vengono dallo stesso periodo.

## Due livelli

- **ER di periodo** (dashboard hero, sintesi briefing): calcolato sull'aggregato del periodo, usando `total_interactions` di `daily_snapshot`.
  - Formula: `SUM(total_interactions) / SUM(reach) * 100`
  - ⚠️ `total_interactions` include anche **profile activity** (follow dal post, tap sul profilo), quindi gonfia leggermente rispetto alla somma dei 4 componenti standard. Il numero è leggermente più alto dell'ER per-post calcolato manualmente.
- **ER per-post** (post card, scatter plot): calcolato dal singolo post.
  - Formula: `(like_count + comments_count + saved + shares) / reach * 100` dal `post_snapshot` più recente.

## Perché su reach e non su follower

Il dashboard dice `ER = interactions / reach`, non `interactions / followers`. Due motivi:

1. **Più severo**: reach ≤ followers normalmente, quindi il denominatore è più piccolo in un ER su follower → sembra più alto di quello che è. L'ER su reach risponde meglio alla domanda "quante persone tra quelle che HANNO VISTO il contenuto hanno interagito".
2. **Più equo cross-account**: account grandi hanno reach/follower bassi (algo IG spinge meno a tutti i follower), account piccoli spesso più alti. ER su follower penalizza i grandi, ER su reach è più comparabile.

**Caveat**: per account piccoli (<1000 follower) il reach include spesso molti non-follower (esplora, reels push) → ER su reach è naturalmente più basso. Tenerne conto nei briefing.

## Tier IG (da [.claude/skills/pulp-briefing/references/benchmarks.md](../../.claude/skills/pulp-briefing/references/benchmarks.md))

| Tier | Soglia ER |
|---|---|
| excellent | > 6% |
| good | 3 – 6% |
| average | 1 – 3% |
| poor | < 1% |

## Pitfall da evitare

- **Campioni piccoli (<3 post nel periodo)**: l'ER è dominato dalla varianza. Un singolo reel fortunato alza tutto. I briefing devono dichiarare il sample size.
- **Confrontare ER di reels vs carousel**: i carousel hanno mediamente ER più alto (più saved, più share via DM). Se si fa il confronto, farlo intra-tipo.
- **Reach molto basso (<50)**: il rapporto diventa instabile. Un solo salvato sposta l'ER di diversi punti percentuali.
- **Non confondere l'ER di periodo con l'ER medio dei post**. `SUM(interactions) / SUM(reach)` ≠ `AVG((interactions/reach) per ogni post)`. La seconda sovrappesa post con reach basso.

## Dove vive nel codice

- Dashboard: `engagementRate` in [App.jsx](../../ig-dashboard/src/App.jsx) — calcolato dal hook `useMemo` su `totals`
- Per-post: campo `er` in `enrichedPosts` sempre in App.jsx
- Export JSON (deploy pubblico): pre-calcolato lato server in [scripts/export-json.js](../../ig-dashboard/scripts/export-json.js)

## Riferimenti

- [concepts/reach-deduplication.md](reach-deduplication.md) — importante per capire come si muove il denominatore
- [.claude/skills/pulp-briefing/references/benchmarks.md](../../.claude/skills/pulp-briefing/references/benchmarks.md)
