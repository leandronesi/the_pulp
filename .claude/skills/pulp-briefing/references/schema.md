# SQLite schema — pulp.db (Turso o locale)

Schema autoritativo: [ig-dashboard/scripts/db.js](../../../../ig-dashboard/scripts/db.js). Se diverge dallo script, lo script vince.

## Tabelle

### `daily_snapshot`
Un record per giorno con le metriche macro dell'account.

| Colonna | Tipo | Note |
|---|---|---|
| `date` | TEXT PK | `YYYY-MM-DD`, timezone Europe/Rome |
| `fetched_at` | INTEGER | unix ms |
| `followers_count` | INTEGER | snapshot al momento del fetch |
| `follows_count` | INTEGER | |
| `media_count` | INTEGER | totale post storici |
| `reach` | INTEGER | reach del GIORNO (period=day), non cumulativo |
| `profile_views` | INTEGER | |
| `website_clicks` | INTEGER | spesso 0 |
| `accounts_engaged` | INTEGER | unique |
| `total_interactions` | INTEGER | include profile activity |
| `raw_json` | TEXT | backup response API per re-parsing |

### `post`
Metadata stabile per post. Upsert.

| Colonna | Tipo | Note |
|---|---|---|
| `post_id` | TEXT PK | |
| `timestamp` | TEXT | ISO 8601 UTC (publish time) |
| `media_type` | TEXT | `IMAGE \| VIDEO \| CAROUSEL_ALBUM \| REELS` |
| `caption` | TEXT | |
| `permalink` | TEXT | link pubblico IG |
| `media_url` | TEXT | URL firmato, scade ~1h |
| `thumbnail_url` | TEXT | solo VIDEO/REELS |
| `first_seen` / `last_updated` | INTEGER | ms |

### `post_snapshot`
Snapshot delle metriche variabili di ogni post ad ogni fetch. PK `(post_id, fetched_at)` → possiamo ricostruire la curva di crescita.

| Colonna | Tipo | Note |
|---|---|---|
| `post_id` | TEXT | FK |
| `fetched_at` | INTEGER | ms |
| `like_count`, `comments_count` | INTEGER | dai field base IG |
| `reach`, `saved`, `shares`, `views` | INTEGER | dai per-post insights |
| `video_view_total_time` | INTEGER | ms, **REEL-only** (NULL per image/carousel). `ig_reels_video_view_total_time` |
| `avg_watch_time` | INTEGER | ms, **REEL-only** (NULL per image/carousel). `ig_reels_avg_watch_time`. Segnale forte di qualità reel: meglio di `views` perché distingue "guardato 1s" da "guardato 30s" |

Indici: `idx_post_snapshot_post`, `idx_post_snapshot_time`.

**KPI derivati per reel** (calcolati a runtime):
- **Avg watch in secondi** = `avg_watch_time / 1000` — usalo nei briefing in formato `Ns`. Sotto i 3s = il reel non engaga; sopra i 10s = reach qualificato.
- **Watch ratio** = `avg_watch_time / video_duration_ms` — non disponibile (IG non espone la durata via API). Se serve, fallback alla durata letta dal `media_url` (costoso, no).
- Filtro: nei briefing/report che parlano di reel, usa `WHERE p.media_type = 'VIDEO' AND ps.avg_watch_time IS NOT NULL` per escludere reel troppo recenti per cui Meta non ha ancora popolato la metrica.

### `audience_snapshot`
Demographics lifetime, catturati ad ogni daily full snapshot.

| Colonna | Tipo | Note |
|---|---|---|
| `date` | TEXT | `YYYY-MM-DD` |
| `breakdown` | TEXT | `age \| gender \| city \| country` |
| `key` | TEXT | es. `18-24`, `F`, `Milano`, `IT` |
| `value` | INTEGER | |

PK `(date, breakdown, key)`. Indice `idx_audience_date`.

### `run_log`
Telemetria degli script. Utile per diagnosticare se un cron ha fallito.

| Colonna | Tipo | Note |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `started_at`, `finished_at` | INTEGER | ms |
| `kind` | TEXT | `snapshot`, `snapshot-fresh`, `briefing`, ecc. |
| `status` | TEXT | `ok`, `partial`, `error` |
| `summary` | TEXT | JSON col payload |
| `error` | TEXT | null se status ok |

### `story`
Metadata stabile per story. Le stories scadono dopo 24h da IG, ma noi le manteniamo nel DB indefinitamente per analisi storica. Upsert.

| Colonna | Tipo | Note |
|---|---|---|
| `story_id` | TEXT PK | |
| `timestamp` | TEXT | ISO 8601 UTC (publish time) |
| `media_type` | TEXT | `IMAGE \| VIDEO` |
| `permalink` | TEXT | dopo 24h restituisce 404 IG |
| `media_url` | TEXT | URL firmato, scade ~1h |
| `thumbnail_url` | TEXT | solo VIDEO |
| `expires_at` | INTEGER | timestamp + 24h, ms |
| `first_seen` / `last_updated` | INTEGER | ms |

### `story_snapshot`
Snapshot delle metriche di ogni story ad ogni cron 4h. Le stories vivono 24h, quindi tipicamente abbiamo 5-6 snapshot per story (curva di consumo). PK `(story_id, fetched_at)`.

| Colonna | Tipo | Note |
|---|---|---|
| `story_id` | TEXT | FK |
| `fetched_at` | INTEGER | ms |
| `reach` | INTEGER | unique account che hanno visto |
| `replies` | INTEGER | risposte (DM diretti via story-reply) |
| `navigation` | INTEGER | totale azioni di navigazione (uscite + avanti + indietro + next-story) |
| `shares` | INTEGER | condivisioni |
| `total_interactions` | INTEGER | aggregato di replies+reactions+altre interazioni dirette |

Indici: `idx_story_snapshot_story`, `idx_story_snapshot_time`.

**KPI derivati per stories** (calcolati a runtime, non in DB):
- **Completion rate** = `1 - exits/reach` — non disponibile direttamente perché Meta non espone `exits` separato in modo affidabile (è dentro `navigation`). Approssimazione possibile via `1 - navigation/(reach * N_frames)` su stories multi-frame, ma rumorosa.
- **Reply rate** = `replies / reach × 100` — segnale forte di affinità (DM è high-effort).
- **Navigation per reach** = `navigation / reach` — quanto interagiscono navigando dentro/fuori. Valori >1 = molti tap forward/back.

Nota: le metriche `taps_forward`, `taps_back`, `swipe_forward`, `exits` separate sono colonne presenti nello schema per back-compat ma **non vengono popolate** — il breakdown `story_navigation_action_type` è instabile tra versioni Graph API e abbiamo scelto di salvare solo l'aggregato `navigation`.

### `meta`
KV store per cache. Attualmente: `ig_user_id`.

## Query tipiche per briefing

### Follower delta settimanale
```sql
SELECT
  MAX(followers_count) AS last,
  (SELECT followers_count FROM daily_snapshot
   WHERE date <= date('now', '-7 days')
   ORDER BY date DESC LIMIT 1) AS week_ago,
  MAX(followers_count) - (...) AS delta
FROM daily_snapshot WHERE date >= date('now', '-1 days');
```

### Reach aggregato di un periodo
```sql
SELECT SUM(reach) AS reach_sum, SUM(total_interactions) AS inter_sum
FROM daily_snapshot WHERE date BETWEEN ? AND ?;
```

### Curva di crescita di un post
```sql
SELECT fetched_at, reach, like_count, comments_count, saved, shares, views
FROM post_snapshot WHERE post_id = ?
ORDER BY fetched_at ASC;
```

### Top post per ER nel periodo
```sql
SELECT p.post_id, p.caption, p.media_type, p.timestamp,
       MAX(s.reach) AS reach,
       MAX(s.like_count + s.comments_count + s.saved + s.shares) AS inter,
       CASE WHEN MAX(s.reach) > 0
            THEN 100.0 * MAX(s.like_count + s.comments_count + s.saved + s.shares) / MAX(s.reach)
            ELSE 0 END AS er
FROM post p
JOIN post_snapshot s ON s.post_id = p.post_id
WHERE p.timestamp BETWEEN ? AND ?
GROUP BY p.post_id
ORDER BY er DESC LIMIT 5;
```

### Audience shift (genere) tra due date
```sql
SELECT a1.key,
       a1.value AS cur,
       a2.value AS prev,
       a1.value - a2.value AS delta
FROM audience_snapshot a1
LEFT JOIN audience_snapshot a2
  ON a2.breakdown = a1.breakdown AND a2.key = a1.key AND a2.date = ?
WHERE a1.breakdown = 'gender' AND a1.date = ?;
```
