# ADR 006 — Chat agent dentro il dashboard

**Data**: 2026-04-24
**Status**: accettata, Phase 1 (dev-only) implementata

## Contesto

Il dashboard mostra numeri ma chi non è del mestiere non sa interpretarli: "tier excellent ma reach 141, è buono o no?", "cosa vuol dire engagement rate?", "qual è il mio post migliore?". Serve un livello conversazionale sopra i dati.

Tre gradi di complessità:
- **C1** Solo spiegatore: LLM risponde a domande concettuali usando i documenti del progetto. Niente query, niente dati live.
- **C2** Lettore di stato: LLM ha accesso allo state del dashboard (numeri attualmente visibili) e interpreta.
- **C3** Analista: LLM può eseguire query ad-hoc su Turso per rispondere a domande specifiche ("top 5 post per ER ultimi 30gg").

## Opzioni considerate

| Opzione | Pro | Contro |
|---|---|---|
| **C3 via function calling in-browser** | Minimal setup | ⚠️ Impossibile: esporrebbe OpenAI + Turso tokens nel bundle JS pubblico |
| **C3 via backend serverless** (Cloudflare Worker) | Deploy pubblico + sicuro | Setup Worker, gestione secrets cloud |
| **C3 via Vite middleware** (dev only) | Zero infra nuova, usa .env locale | Funziona solo in `npm run dev`, non in build |
| **Phase 1 dev + Phase 2 Worker** | Incrementale, validiamo il UX prima di investire | — |

## Decisione

**Phase 1 ora**: C3 via Vite middleware `/api/chat` in dev. Chat button appare solo se `import.meta.env.DEV === true`, quindi tree-shake-ato dal bundle statico pubblico.

**Phase 2 futuro** (quando avrà senso): espone stesso endpoint via Cloudflare Worker per il deploy pubblico. Il frontend userà `VITE_CHAT_ENDPOINT` per switchare; architettura già pronta.

## Implementazione

- **[scripts/chat-plugin.js](../../ig-dashboard/scripts/chat-plugin.js)** — Vite plugin con `apply: "serve"`. Registra middleware `POST /api/chat` e `GET /api/chat-status`.
- System prompt assemblato da:
  - `.claude/skills/pulp-briefing/references/brand-context.md`
  - `.claude/skills/pulp-briefing/references/benchmarks.md`
  - `.claude/skills/pulp-briefing/references/schema.md`
  - Tutti i `wiki/concepts/*.md` caricati dinamicamente
  - Dashboard state passato dal client (profile, totali, posts visibili)
- **Tool calling**: unica tool `queryTurso(sql)`.
  - Guard: solo `SELECT` o `WITH ... SELECT`, rejecta `DELETE/UPDATE/INSERT/DROP/ALTER/CREATE/TRUNCATE/ATTACH/DETACH/PRAGMA/REINDEX/REPLACE`.
  - No semicolon in mezzo (previene multi-statement injection).
  - Enforce `LIMIT 100` se assente.
  - Esegue via libsql client, ritorna `{columns, rows, rowCount, ms}` al modello per sintesi.
- Loop tool calls max 5 turn per domanda (safety).
- **[src/Chat.jsx](../../ig-dashboard/src/Chat.jsx)** — Chat UI React:
  - Pulsante flottante bottom-right, via portal su `document.body`
  - Drawer laterale destra (420px), glass coerente col tema
  - Messaggi user (align right, bubble cream) vs assistant (align left, glass)
  - Tool call rendering: collapsible block con SQL in `<pre>` + tabella dei risultati (max 10 righe visibili, resto troncato)
  - Input textarea con Enter=invia, Shift+Enter=newline
  - History persistente in `localStorage` (`pulp-chat-history`)
  - Status fetch `/api/chat-status` al primo apri: se OpenAI/Turso assenti, disabilita input con messaggio chiaro

## Modello e costi

Usa `OPENAI_MODEL` da env, default `gpt-5.4-mini`. Un turno con tool call ≈ 15-20k token (system prompt pesante: brand-voice + benchmarks + schema + concetti + state). Con gpt-5.4-mini parliamo di centesimi/giorno anche con uso intensivo.

## Gating

- **Dev**: `import.meta.env.DEV` → true, Chat mount in App.jsx
- **Build statico**: condition false, Chat component tree-shaken. Verificato con `grep "chiedi al pulp" dist/assets/*.js` → 0 match.
- **Override**: `VITE_CHAT_DISABLED=true` per forzare off in dev (utile per screenshot puliti).

## Conseguenze

**Positive:**
- In locale hai un analista che spiega e interroga. Utile per imparare a leggere i dati + per scovare pattern non visibili nel dashboard.
- Nessun rischio per la versione pubblica (zero chat, zero secrets).
- Architettura pronta per Phase 2 (swap endpoint).

**Negative:**
- Chat non funziona per visitatori del sito pubblico (accettato per ora).
- Context window caricato ogni turno (15-20k token) — se diventa costoso, si può introdurre prompt caching OpenAI.
- Safety SQL guard è regex-based, non parser vero. Attacco SQL injection sofisticato teoricamente possibile, ma: (a) il DB è solo lettura analytics, nessun dato sensibile, (b) il token Turso è dev-only.

## Quando riconsiderare

- Se uso intensivo → valutare prompt caching (supportato da OpenAI)
- Se va deployato pubblico → implementare Phase 2 con Cloudflare Worker
- Se l'LLM genera query pericolose regolarmente → upgrade a parser SQL vero (`node-sql-parser`)

## Riferimenti

- [.claude/skills/pulp-briefing/SKILL.md](../../.claude/skills/pulp-briefing/SKILL.md) — il chat agent condivide brand voice e workflow della skill briefing
- [wiki/decisions/004-skill-based-briefing.md](004-skill-based-briefing.md) — pattern skill come source of truth, esteso qui al chat
- OpenAI function calling docs
