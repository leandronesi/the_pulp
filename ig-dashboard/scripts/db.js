// DB layer condiviso da tutti gli script analytics.
// Apre (creandolo se manca) data/pulp.db e applica lo schema.
// Uso: import { getDb } from "./db.js";

import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");
export const DB_PATH = resolve(DATA_DIR, "pulp.db");

// Schema. Ogni CREATE è IF NOT EXISTS → chiamare ensureSchema() è idempotente
// e funziona sia come init che come migrazione "additiva".
const SCHEMA = `
CREATE TABLE IF NOT EXISTS daily_snapshot (
  date TEXT PRIMARY KEY,                    -- YYYY-MM-DD (Europe/Rome)
  fetched_at INTEGER NOT NULL,              -- unix ms
  followers_count INTEGER,
  follows_count INTEGER,
  media_count INTEGER,
  reach INTEGER,                            -- reach della giornata (period=day)
  profile_views INTEGER,
  website_clicks INTEGER,
  accounts_engaged INTEGER,
  total_interactions INTEGER,
  raw_json TEXT                             -- response API grezza per ri-parsing futuro
);

CREATE TABLE IF NOT EXISTS post (
  post_id TEXT PRIMARY KEY,
  timestamp TEXT,                           -- ISO 8601 UTC (publish time)
  media_type TEXT,
  caption TEXT,
  permalink TEXT,
  media_url TEXT,
  thumbnail_url TEXT,
  first_seen INTEGER NOT NULL,              -- ms, prima volta che il post è entrato nel DB
  last_updated INTEGER NOT NULL             -- ms, ultimo refresh metadata
);

CREATE TABLE IF NOT EXISTS post_snapshot (
  post_id TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,              -- ms; ogni fetch crea una nuova riga
  like_count INTEGER,
  comments_count INTEGER,
  reach INTEGER,
  saved INTEGER,
  shares INTEGER,
  views INTEGER,
  PRIMARY KEY (post_id, fetched_at),
  FOREIGN KEY (post_id) REFERENCES post(post_id)
);

CREATE INDEX IF NOT EXISTS idx_post_snapshot_post ON post_snapshot(post_id);
CREATE INDEX IF NOT EXISTS idx_post_snapshot_time ON post_snapshot(fetched_at);
CREATE INDEX IF NOT EXISTS idx_post_timestamp ON post(timestamp);

CREATE TABLE IF NOT EXISTS audience_snapshot (
  date TEXT NOT NULL,                       -- YYYY-MM-DD
  breakdown TEXT NOT NULL,                  -- 'age' | 'gender' | 'city' | 'country'
  key TEXT NOT NULL,                        -- es. '18-24', 'F', 'Milano', 'IT'
  value INTEGER NOT NULL,
  PRIMARY KEY (date, breakdown, key)
);

CREATE INDEX IF NOT EXISTS idx_audience_date ON audience_snapshot(date);

CREATE TABLE IF NOT EXISTS run_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,              -- ms
  finished_at INTEGER,                      -- ms, null se crashato
  kind TEXT NOT NULL,                       -- 'snapshot' | 'briefing' | 'post-mortem' | ...
  status TEXT,                              -- 'ok' | 'error' | 'partial'
  summary TEXT,                             -- testo libero, anche JSON se utile
  error TEXT                                -- solo se status = 'error'
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER
);
`;

let _db = null;

export function getDb() {
  if (_db) return _db;
  mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.exec(SCHEMA);
  return _db;
}

// Utility: data di oggi in YYYY-MM-DD (Europe/Rome per rispettare il fuso business)
export function todayIsoDate() {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // sv-SE formatta come YYYY-MM-DD
}

// Inizia un run log — ritorna id da chiudere poi con endRunLog
export function startRunLog(kind) {
  const db = getDb();
  const res = db
    .prepare("INSERT INTO run_log (started_at, kind) VALUES (?, ?)")
    .run(Date.now(), kind);
  return res.lastInsertRowid;
}

export function endRunLog(id, { status, summary, error } = {}) {
  const db = getDb();
  db.prepare(
    "UPDATE run_log SET finished_at = ?, status = ?, summary = ?, error = ? WHERE id = ?"
  ).run(Date.now(), status || "ok", summary || null, error || null, id);
}

export function setMeta(key, value) {
  const db = getDb();
  db.prepare(
    "INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run(key, String(value), Date.now());
}

export function getMeta(key) {
  const db = getDb();
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row?.value ?? null;
}
