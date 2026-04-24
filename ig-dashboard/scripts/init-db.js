// One-shot: apre il DB (crea data/pulp.db se manca) e applica lo schema.
// getDb() è idempotente: rigirarlo è sicuro e non tocca i dati esistenti.
// Uso: npm run init-db

import { getDb, DB_PATH } from "./db.js";

const db = getDb();

// Conta le righe delle tabelle principali per conferma visiva
const tables = [
  "daily_snapshot",
  "post",
  "post_snapshot",
  "audience_snapshot",
  "run_log",
  "meta",
];

console.log(`DB pronto: ${DB_PATH}`);
console.log("─".repeat(60));
for (const t of tables) {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get();
  console.log(`  ${t.padEnd(24)} ${String(n).padStart(8)} righe`);
}
console.log("─".repeat(60));
console.log("Schema applicato. Prossimo passo: npm run snapshot");
