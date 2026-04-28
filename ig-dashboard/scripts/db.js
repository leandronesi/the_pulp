// DB layer condiviso da tutti gli script analytics.
// Supporta sia Turso (remoto via libsql) che un file SQLite locale come fallback.
//
// Env vars:
//   TURSO_DATABASE_URL   — es. libsql://pulp-leandronesi.turso.io
//   TURSO_AUTH_TOKEN     — JWT del DB
//
// Se TURSO_DATABASE_URL è settata → scrive su Turso.
// Altrimenti → ricade su file locale data/pulp.db.
//
// Gli script Node devono essere lanciati con --env-file=.env per caricare le env.

import { createClient } from "@libsql/client";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");
const LOCAL_DB = resolve(DATA_DIR, "pulp.db");

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS daily_snapshot (
    date TEXT PRIMARY KEY,
    fetched_at INTEGER NOT NULL,
    followers_count INTEGER,
    follows_count INTEGER,
    media_count INTEGER,
    reach INTEGER,
    profile_views INTEGER,
    website_clicks INTEGER,
    accounts_engaged INTEGER,
    total_interactions INTEGER,
    raw_json TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS post (
    post_id TEXT PRIMARY KEY,
    timestamp TEXT,
    media_type TEXT,
    caption TEXT,
    permalink TEXT,
    media_url TEXT,
    thumbnail_url TEXT,
    first_seen INTEGER NOT NULL,
    last_updated INTEGER NOT NULL
  )`,
  // video_view_total_time / avg_watch_time: in millisecondi, popolati SOLO
  // per media_product_type=REELS via fetch dedicato (ig_reels_*). NULL per
  // image/carousel — IG non li espone fuori dal feed reels.
  `CREATE TABLE IF NOT EXISTS post_snapshot (
    post_id TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    like_count INTEGER,
    comments_count INTEGER,
    reach INTEGER,
    saved INTEGER,
    shares INTEGER,
    views INTEGER,
    video_view_total_time INTEGER,
    avg_watch_time INTEGER,
    PRIMARY KEY (post_id, fetched_at)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_post_snapshot_post ON post_snapshot(post_id)`,
  `CREATE INDEX IF NOT EXISTS idx_post_snapshot_time ON post_snapshot(fetched_at)`,
  `CREATE INDEX IF NOT EXISTS idx_post_timestamp ON post(timestamp)`,
  `CREATE TABLE IF NOT EXISTS audience_snapshot (
    date TEXT NOT NULL,
    breakdown TEXT NOT NULL,
    key TEXT NOT NULL,
    value INTEGER NOT NULL,
    PRIMARY KEY (date, breakdown, key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audience_date ON audience_snapshot(date)`,
  `CREATE TABLE IF NOT EXISTS story (
    story_id TEXT PRIMARY KEY,
    timestamp TEXT,
    media_type TEXT,
    permalink TEXT,
    media_url TEXT,
    thumbnail_url TEXT,
    expires_at INTEGER,
    first_seen INTEGER NOT NULL,
    last_updated INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_story_timestamp ON story(timestamp)`,
  // story_snapshot: navigation = totale aggregato di azioni di navigazione
  // (uscite + avanti + indietro + prossima storia). IG non espone in modo
  // affidabile il breakdown delle 4 sotto-metriche — usiamo l'aggregato.
  // Le colonne taps_* / swipe_* / exits sono legacy: restano per DB che le
  // hanno gia' (back-compat), nuovi DB le hanno ma non vengono popolate.
  `CREATE TABLE IF NOT EXISTS story_snapshot (
    story_id TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    reach INTEGER,
    replies INTEGER,
    navigation INTEGER,
    shares INTEGER,
    total_interactions INTEGER,
    taps_forward INTEGER,
    taps_back INTEGER,
    swipe_forward INTEGER,
    exits INTEGER,
    PRIMARY KEY (story_id, fetched_at)
  )`,
  // Migration in-place: aggiunge la colonna navigation se manca (per DB che
  // hanno gia' la versione precedente dello schema). ALTER TABLE ADD COLUMN
  // e' idempotente solo via try/catch — gestito a parte sotto.
  `CREATE INDEX IF NOT EXISTS idx_story_snapshot_story ON story_snapshot(story_id)`,
  `CREATE INDEX IF NOT EXISTS idx_story_snapshot_time ON story_snapshot(fetched_at)`,
  `CREATE TABLE IF NOT EXISTS run_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    kind TEXT NOT NULL,
    status TEXT,
    summary TEXT,
    error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER
  )`,
];

let _db = null;
let _mode = null;

export async function getDb() {
  if (_db) return _db;

  const remoteUrl = process.env.TURSO_DATABASE_URL?.trim();
  if (remoteUrl) {
    _db = createClient({
      url: remoteUrl,
      authToken: process.env.TURSO_AUTH_TOKEN?.trim(),
    });
    _mode = "turso";
  } else {
    mkdirSync(DATA_DIR, { recursive: true });
    _db = createClient({ url: `file:${LOCAL_DB}` });
    _mode = "local";
  }

  for (const stmt of SCHEMA_STATEMENTS) {
    await _db.execute(stmt);
  }
  // Migration: aggiungi colonna `navigation` a story_snapshot se manca
  // (DB pre-esistenti dal primo prototipo stories).
  try {
    await _db.execute(`ALTER TABLE story_snapshot ADD COLUMN navigation INTEGER`);
  } catch {
    /* colonna gia' esiste, ignora */
  }
  // Migration: watch time reel-only su post_snapshot (DB pre-esistenti).
  for (const col of ["video_view_total_time", "avg_watch_time"]) {
    try {
      await _db.execute(`ALTER TABLE post_snapshot ADD COLUMN ${col} INTEGER`);
    } catch {
      /* colonna gia' esiste, ignora */
    }
  }
  // Migration retroattiva (one-shot): fino al 28/04/2026 il daily cron
  // etichettava le righe `daily_snapshot` con la data del run (00:00 Rome
  // di oggi) invece che con la data del periodo coperto (ieri). Le righe
  // esistenti hanno quindi date scorrette di +1 giorno. Shiftiamo tutto di
  // -1 giorno, una sola volta, segnando il flag in `meta`. Il codice nuovo
  // userà yesterdayIsoDate() per il daily e todayIsoDate() per l'orario,
  // entrambi corretti.
  try {
    const flag = await _db.execute({
      sql: "SELECT value FROM meta WHERE key = ?",
      args: ["daily_date_offset_fix_v1"],
    });
    if (!flag.rows.length) {
      await _db.execute(
        `UPDATE daily_snapshot SET date = date(date, '-1 day')`
      );
      await _db.execute({
        sql: `INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        args: ["daily_date_offset_fix_v1", "applied", Date.now()],
      });
      console.log("[migration] daily_snapshot.date shiftato di -1gg (one-shot fix off-by-one)");
    }
  } catch (e) {
    console.warn(`[migration] daily_date_offset_fix_v1 fallita: ${e.message}`);
  }
  return _db;
}

export function getDbMode() {
  return _mode;
}

export function getDbTarget() {
  return _mode === "turso" ? process.env.TURSO_DATABASE_URL : LOCAL_DB;
}

// Utility: data di oggi in YYYY-MM-DD (Europe/Rome)
export function todayIsoDate() {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

// Utility: data di ieri in YYYY-MM-DD (Europe/Rome). Usata dal daily cron per
// etichettare la riga `daily_snapshot` con la data effettiva del periodo
// fotografato — quando il cron gira a 00:00 Rome la finestra di metriche è
// quella del giorno precedente, non di quello in cui parte la run.
export function yesterdayIsoDate() {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

export async function startRunLog(kind) {
  const db = await getDb();
  const res = await db.execute({
    sql: "INSERT INTO run_log (started_at, kind) VALUES (?, ?)",
    args: [Date.now(), kind],
  });
  return Number(res.lastInsertRowid);
}

export async function endRunLog(id, { status, summary, error } = {}) {
  const db = await getDb();
  await db.execute({
    sql: "UPDATE run_log SET finished_at = ?, status = ?, summary = ?, error = ? WHERE id = ?",
    args: [Date.now(), status || "ok", summary || null, error || null, id],
  });
}

export async function setMeta(key, value) {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, String(value), Date.now()],
  });
}

export async function getMeta(key) {
  const db = await getDb();
  const res = await db.execute({
    sql: "SELECT value FROM meta WHERE key = ?",
    args: [key],
  });
  return res.rows[0]?.value ?? null;
}

// Conteggi delle tabelle principali — usato da init-db e da report status.
export async function countTables() {
  const db = await getDb();
  const tables = [
    "daily_snapshot",
    "post",
    "post_snapshot",
    "audience_snapshot",
    "run_log",
    "meta",
  ];
  const out = {};
  for (const t of tables) {
    const r = await db.execute(`SELECT COUNT(*) AS n FROM ${t}`);
    out[t] = Number(r.rows[0].n);
  }
  return out;
}
