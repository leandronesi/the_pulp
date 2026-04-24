// One-shot: apre il DB (Turso se TURSO_DATABASE_URL è settata, altrimenti
// data/pulp.db) e applica lo schema. getDb() è idempotente.
//
// Uso: npm run init-db

import { getDb, getDbMode, getDbTarget, countTables } from "./db.js";

await getDb(); // applica schema
const mode = getDbMode();
const target = getDbTarget();

console.log(`DB pronto (${mode}): ${target}`);
console.log("─".repeat(60));
const counts = await countTables();
for (const [t, n] of Object.entries(counts)) {
  console.log(`  ${t.padEnd(24)} ${String(n).padStart(8)} righe`);
}
console.log("─".repeat(60));
console.log("Schema applicato. Prossimo passo: npm run snapshot");
