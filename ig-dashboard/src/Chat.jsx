// Chat agent per The Pulp dashboard.
// Disponibile solo in dev (import.meta.env.DEV) perché dipende dal middleware
// Vite /api/chat che non esiste in produzione.
//
// Renderizza:
// - Pulsante flottante bottom-right
// - Drawer laterale con conversazione
// - Messaggi user / assistant
// - Tool calls con SQL e tabella dei risultati inline
//
// Chiama POST /api/chat con { messages, dashboardState }. Stato convo in
// localStorage così non si perde al refresh.

import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  MessageSquare,
  X,
  Send,
  Loader2,
  Database,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";
import { resolveMediaType } from "./analytics.js";

const STORAGE_KEY = "pulp-chat-history";

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(msgs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
  } catch {
    /* noop */
  }
}

function ResultTable({ result }) {
  if (result.error) {
    return (
      <div className="text-[11px] text-[#D98B6F] mono-font mt-2">
        errore: {result.error}
      </div>
    );
  }
  const cols = result.columns || [];
  const rows = result.rows || [];
  const visible = rows.slice(0, 10);
  const more = rows.length - visible.length;

  return (
    <div className="mt-2 text-[10px] mono-font overflow-x-auto">
      <div className="text-white/40 mb-1">
        {result.rowCount} righe · {result.ms}ms
        {more > 0 && ` · mostrate le prime 10`}
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-[#EDE5D0]/80 border-b border-white/10">
            {cols.map((c) => (
              <th key={c} className="text-left px-2 py-1 font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((r, i) => (
            <tr
              key={i}
              className="border-b border-white/5 text-white/80"
            >
              {cols.map((c) => {
                const v = r[c];
                let display =
                  v == null
                    ? "—"
                    : typeof v === "string"
                    ? v.length > 80
                      ? v.slice(0, 80) + "…"
                      : v
                    : String(v);
                return (
                  <td key={c} className="px-2 py-1 align-top">
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ToolCallBlock({ call, result }) {
  const [open, setOpen] = useState(true);
  const sql = useMemo(() => {
    try {
      const args = JSON.parse(call.function?.arguments || "{}");
      return args.sql || "";
    } catch {
      return "";
    }
  }, [call]);

  return (
    <div className="glass rounded-lg p-3 my-2 border border-[#EDE5D0]/10">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-[10px] mono-font text-[#EDE5D0]/70 hover:text-[#EDE5D0] transition w-full text-left"
      >
        <Database size={11} />
        <span className="uppercase tracking-wider">query turso</span>
        {result && !result.error && (
          <span className="text-white/40 ml-auto">
            {result.rowCount ?? 0} righe
          </span>
        )}
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>
      {open && (
        <>
          <pre className="mt-2 text-[10px] mono-font text-white/60 bg-black/20 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
            {sql}
          </pre>
          {result && <ResultTable result={result} />}
        </>
      )}
    </div>
  );
}

function MessageBubble({ msg, toolResults }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 bg-[#EDE5D0]/10 text-white/90 text-[13px]">
          {msg.content}
        </div>
      </div>
    );
  }

  if (msg.role === "assistant") {
    return (
      <div className="mb-3">
        {msg.content && (
          <div className="glass rounded-2xl rounded-bl-sm px-3 py-2 text-[13px] text-white/85 leading-relaxed whitespace-pre-wrap">
            {msg.content}
          </div>
        )}
        {msg.tool_calls?.map((call) => (
          <ToolCallBlock
            key={call.id}
            call={call}
            result={toolResults[call.id]}
          />
        ))}
      </div>
    );
  }

  return null; // tool messages renderizzati nel ToolCallBlock del parent
}

function buildDashboardState({
  account,
  insights,
  insightsPrev,
  posts,
  audience,
  dateRange,
}) {
  if (!account) return null;
  return {
    dateRange: `${dateRange}g`,
    profile: {
      username: account.username,
      followers: account.followers_count,
      follows: account.follows_count,
      mediaCount: account.media_count,
    },
    periodTotals: insights?.totals || {},
    previousPeriodTotals: insightsPrev?.totals || {},
    postsVisible: (posts || []).length,
    firstPostsInFeed: (posts || []).slice(0, 5).map((p) => ({
      id: p.id,
      mediaType: resolveMediaType(p),
      timestamp: p.timestamp,
      caption: (p.caption || "").slice(0, 80),
    })),
    audienceBreakdowns: audience ? Object.keys(audience) : [],
  };
}

export default function Chat(props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(loadHistory());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null); // { enabled, model, tursoAvailable }
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Check status una volta al primo apertura
  useEffect(() => {
    if (!open || status) return;
    fetch("/api/chat-status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, error: true }));
  }, [open, status]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  // Mappa tool_call_id → result per render efficace
  const toolResults = useMemo(() => {
    const map = {};
    for (const m of messages) {
      if (m.role === "tool" && m.tool_call_id) {
        map[m.tool_call_id] = m.result;
      }
    }
    return map;
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const userMsg = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    saveHistory(next);
    setInput("");
    setLoading(true);

    try {
      // Il server vuole messages in formato OpenAI (no custom result field).
      // Ricostruiamo la history serializzando tool messages col content = JSON.stringify(result).
      const apiMessages = next
        .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "tool")
        .map((m) => {
          if (m.role === "tool") {
            return {
              role: "tool",
              tool_call_id: m.tool_call_id,
              content: JSON.stringify(m.result),
            };
          }
          if (m.role === "assistant") {
            return {
              role: "assistant",
              content: m.content || "",
              ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
            };
          }
          return { role: "user", content: m.content };
        });

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          dashboardState: buildDashboardState(props),
        }),
      });
      const j = await res.json();
      if (j.error) {
        const errMsg = {
          role: "assistant",
          content: `⚠ errore: ${j.error}`,
        };
        const after = [...next, errMsg];
        setMessages(after);
        saveHistory(after);
        return;
      }
      const after = [...next, ...(j.transcript || [])];
      setMessages(after);
      saveHistory(after);
    } catch (e) {
      const errMsg = {
        role: "assistant",
        content: `⚠ errore di rete: ${e.message}`,
      };
      const after = [...next, errMsg];
      setMessages(after);
      saveHistory(after);
    } finally {
      setLoading(false);
    }
  }

  function clearHistory() {
    if (!confirm("Cancello la chat?")) return;
    setMessages([]);
    saveHistory([]);
  }

  if (!open) {
    return createPortal(
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-[9998] glass rounded-full px-4 py-3 flex items-center gap-2 text-sm mono-font text-white/80 hover:text-white shadow-xl transition"
        style={{ backdropFilter: "blur(20px)" }}
      >
        <MessageSquare size={16} />
        chiedi al pulp
      </button>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-y-0 right-0 z-[9998] w-full sm:w-[440px] max-w-full flex flex-col shadow-2xl"
      style={{
        background: "linear-gradient(180deg, #0B3A30 0%, #052019 100%)",
        borderLeft: "1px solid rgba(237,229,208,0.1)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/5 shrink-0">
        <div>
          <div className="text-xs mono-font uppercase tracking-[0.3em] text-[#EDE5D0]/70">
            Chiedi al Pulp
          </div>
          <div className="text-[10px] mono-font text-white/40 mt-0.5">
            {status
              ? status.enabled
                ? `${status.model}${status.tursoAvailable ? " · turso on" : " · turso off"}`
                : "LLM non disponibile — check OPENAI_API_KEY in .env"
              : "…"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              className="text-white/40 hover:text-white/80 transition"
              title="Cancella storia"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            className="text-white/60 hover:text-white transition"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4"
        style={{ fontFamily: '"Inter", system-ui, sans-serif' }}
      >
        {messages.length === 0 && (
          <div className="text-center text-white/40 text-xs mono-font py-10 leading-relaxed">
            <p className="mb-4">Chiedi una cosa tipo:</p>
            <ul className="space-y-2 text-left max-w-[280px] mx-auto">
              <li>· "Che vuol dire engagement rate?"</li>
              <li>· "Qual è il post con più reach nell'ultima settimana?"</li>
              <li>· "Come sta andando il follower trend?"</li>
              <li>· "Il mio ER 12.1% è alto o basso?"</li>
              <li>· "Top 5 città dei miei follower"</li>
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} msg={m} toolResults={toolResults} />
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-white/50 text-xs mono-font">
            <Loader2 size={14} className="animate-spin" />
            sta pensando…
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-white/5 shrink-0">
        <div className="glass rounded-2xl flex items-end gap-2 p-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="chiedi qualcosa..."
            rows={1}
            disabled={loading || (status && !status.enabled)}
            className="flex-1 bg-transparent text-white text-sm resize-none outline-none placeholder:text-white/30 py-1 px-2 disabled:opacity-50"
            style={{
              fontFamily: '"Inter", system-ui, sans-serif',
              maxHeight: "120px",
              minHeight: "24px",
            }}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim() || (status && !status.enabled)}
            className="shrink-0 rounded-full p-2 bg-[#EDE5D0] text-[#0B3A30] hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
          </button>
        </div>
        <p className="text-[9px] text-white/30 mono-font mt-2 text-center">
          enter per inviare · shift+enter nuova riga
        </p>
      </div>
    </div>,
    document.body
  );
}
