// Vite plugin: espone /api/chat in dev mode.
// - Riceve { messages, dashboardState } dal client
// - Costruisce system prompt da skill references + wiki concepts
// - Usa OpenAI function calling con tool `queryTurso` (SELECT-only sul DB)
// - Loop finché il modello finisce le tool calls, ritorna intera trascrizione
//
// In produzione (build statico) questo plugin non esiste → /api/chat 404.

import { readFileSync as rfs, existsSync as exs, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@libsql/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(PROJECT_ROOT, "..");
const SKILL_REFS = resolve(REPO_ROOT, ".claude/skills/pulp-briefing/references");
const WIKI_CONCEPTS = resolve(REPO_ROOT, "wiki/concepts");

function safeRead(path) {
  try {
    return exs(path) ? rfs(path, "utf8") : null;
  } catch {
    return null;
  }
}

function loadAllConcepts() {
  if (!exs(WIKI_CONCEPTS)) return "";
  const files = readdirSync(WIKI_CONCEPTS).filter((f) => f.endsWith(".md"));
  return files
    .map((f) => `### [concepts/${f}]\n\n${safeRead(resolve(WIKI_CONCEPTS, f))}`)
    .join("\n\n---\n\n");
}

// SQL safety guard: accetta solo SELECT (o WITH ... SELECT). Limita righe.
// Timeout a runtime livello libsql (5s). Nega semicolon in mezzo, keyword mutanti.
function validateSql(sql) {
  let trimmed = sql.trim().replace(/;+\s*$/, "");
  const upper = trimmed.toUpperCase();
  if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
    throw new Error("Solo query SELECT (o CTE WITH ... SELECT) consentite.");
  }
  if (trimmed.includes(";")) {
    throw new Error("Niente semicolon in mezzo alla query.");
  }
  const forbidden = [
    "DELETE",
    "UPDATE",
    "INSERT",
    "DROP",
    "ALTER",
    "CREATE",
    "TRUNCATE",
    "ATTACH",
    "DETACH",
    "PRAGMA",
    "REINDEX",
    "REPLACE",
  ];
  for (const kw of forbidden) {
    // parola intera
    const re = new RegExp(`\\b${kw}\\b`);
    if (re.test(upper)) {
      throw new Error(`Parola chiave vietata: ${kw}`);
    }
  }
  if (!/\bLIMIT\b/.test(upper)) {
    trimmed = `${trimmed} LIMIT 100`;
  }
  return trimmed;
}

async function executeQuery(sql) {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL non configurata");
  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const safeSql = validateSql(sql);
  const t0 = Date.now();
  const res = await db.execute(safeSql);
  const ms = Date.now() - t0;
  // Normalizza: libsql rows sono object ma con proprietà "get-esque" — stringify safe
  const rows = res.rows.map((r) => {
    const o = {};
    for (const col of res.columns) o[col] = r[col];
    return o;
  });
  return {
    sql: safeSql,
    columns: res.columns,
    rows,
    rowCount: rows.length,
    ms,
  };
}

function buildSystemPrompt(dashboardState) {
  const brandVoice = safeRead(resolve(SKILL_REFS, "brand-context.md")) || "";
  const benchmarks = safeRead(resolve(SKILL_REFS, "benchmarks.md")) || "";
  const schema = safeRead(resolve(SKILL_REFS, "schema.md")) || "";
  const concepts = loadAllConcepts();

  return [
    "Sei l'assistente analista di The Pulp (account IG community, Roma-centric, 474 follower ca.).",
    "Rispondi in italiano editoriale come descritto nel BRAND VOICE. Niente marketing-speak, trattini per ritmo, cita post concreti non 'un contenuto recente'.",
    "",
    "Se la domanda richiede dati specifici (numeri, classifiche, confronti, curve), usa lo strumento `queryTurso` con una SELECT. Dopo la query COMMENTA i dati — non limitarti a listare.",
    "Per domande concettuali ('che vuol dire ER?') rispondi direttamente usando i CONCETTI qui sotto.",
    "Se il sample è piccolo (dichiarato nello STATO), dillo esplicitamente.",
    "",
    "=== BRAND VOICE ===",
    brandVoice,
    "",
    "=== BENCHMARKS IG ===",
    benchmarks,
    "",
    "=== SCHEMA DB (Turso, libsql-compatibile) ===",
    schema,
    "",
    "=== CONCETTI CHIAVE ===",
    concepts,
    "",
    "=== STATO CORRENTE DASHBOARD ===",
    "```json",
    JSON.stringify(dashboardState ?? {}, null, 2),
    "```",
    "",
    "=== REGOLE ===",
    "1. Mai inventare numeri. Se una query non trova niente, dillo.",
    "2. Non proporre query che mutino il DB (SELECT only — il sistema te lo impedirebbe comunque).",
    "3. Quando citi un post, includi se possibile la caption breve e la data (tipo '21 aprile') per chiarezza.",
    "4. Risposte concise. 2-6 frasi di prosa + eventuale tabella via tool. Niente lunghe introduzioni.",
  ].join("\n");
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "queryTurso",
      description:
        "Esegue una query SELECT (o WITH...SELECT) sul database SQLite Turso del progetto. Usa questo strumento ogni volta che la domanda richiede dati specifici dal DB. Ritorna columns + rows + rowCount.",
      parameters: {
        type: "object",
        properties: {
          sql: {
            type: "string",
            description:
              "La query SELECT. Se manca LIMIT, viene aggiunto LIMIT 100 automaticamente. Tabelle: daily_snapshot, post, post_snapshot, audience_snapshot, run_log, meta.",
          },
        },
        required: ["sql"],
      },
    },
  },
];

async function openaiChat({ messages, model }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY non configurata");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: model || process.env.OPENAI_MODEL || "gpt-5.4-mini",
      messages,
      tools: TOOLS,
      tool_choice: "auto",
    }),
  });
  const j = await res.json();
  if (j.error) {
    throw new Error(`OpenAI error: ${j.error.message}`);
  }
  return j;
}

async function handleChat({ messages, dashboardState }) {
  const systemPrompt = buildSystemPrompt(dashboardState);
  const working = [{ role: "system", content: systemPrompt }, ...messages];
  const transcript = []; // solo le nuove entry da mandare al client

  let totalTokens = 0;
  for (let turn = 0; turn < 5; turn++) {
    const resp = await openaiChat({ messages: working });
    totalTokens +=
      (resp.usage?.prompt_tokens || 0) + (resp.usage?.completion_tokens || 0);
    const choice = resp.choices?.[0];
    if (!choice) throw new Error("OpenAI: nessuna choice");

    const assistantMsg = {
      role: "assistant",
      content: choice.message.content || "",
      tool_calls: choice.message.tool_calls || null,
    };
    working.push(choice.message);
    transcript.push(assistantMsg);

    if (
      choice.finish_reason === "tool_calls" &&
      choice.message.tool_calls?.length
    ) {
      for (const call of choice.message.tool_calls) {
        let toolResult;
        try {
          if (call.function?.name === "queryTurso") {
            const args = JSON.parse(call.function.arguments || "{}");
            toolResult = await executeQuery(args.sql || "");
          } else {
            toolResult = { error: `Tool sconosciuto: ${call.function?.name}` };
          }
        } catch (e) {
          toolResult = { error: e.message };
        }

        const toolMsg = {
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(toolResult),
        };
        working.push(toolMsg);
        transcript.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function?.name,
          result: toolResult,
        });
      }
      continue;
    }
    break;
  }

  return { transcript, totalTokens };
}

export default function chatPlugin() {
  return {
    name: "pulp-chat-middleware",
    apply: "serve", // solo dev server
    configureServer(server) {
      server.middlewares.use("/api/chat", async (req, res, next) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("POST only");
          return;
        }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
          try {
            const parsed = JSON.parse(body || "{}");
            const result = await handleChat({
              messages: parsed.messages || [],
              dashboardState: parsed.dashboardState || null,
            });
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
          } catch (e) {
            console.error("[chat] error:", e.message);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });

      server.middlewares.use("/api/chat-status", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            enabled: !!process.env.OPENAI_API_KEY,
            model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
            tursoAvailable: !!process.env.TURSO_DATABASE_URL,
          })
        );
      });
    },
  };
}
