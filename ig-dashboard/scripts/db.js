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
  `CREATE TABLE IF NOT EXISTS post_snapshot (
    post_id TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    like_count INTEGER,
    comments_count INTEGER,
    reach INTEGER,
    saved INTEGER,
    shares INTEGER,
    views INTEGER,
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
