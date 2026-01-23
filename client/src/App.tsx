import { useEffect, useMemo, useState } from "react";
import {
  listSessions,
  streamChat,
  type ChatEvent,
  type ChatRequest,
} from "./lib/api";
import { useChatStore } from "./lib/store";

function formatResult(result: unknown): string {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result === "object" && "answer" in (result as Record<string, unknown>)) {
    const val = (result as { answer?: unknown }).answer;
    if (typeof val === "string") return val;
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function App() {
  const {
    messages,
    sessions,
    activeSessionId,
    streaming,
    setSessions,
    setActiveSession,
    addMessage,
    updateMessage,
    setStreaming,
    resetMessages,
  } = useChatStore();

  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const result = await listSessions();
      if (result.ok) {
        setSessions(result.sessions);
      } else {
        setError(result.error ?? "Failed to load sessions");
      }
    })();
  }, [setSessions]);

  const sessionTitle = useMemo(() => {
    const session = sessions.find((s) => s.id === activeSessionId);
    return session?.title ?? "New chat";
  }, [sessions, activeSessionId]);

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    setError(null);

    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();

    addMessage({ id: userId, role: "user", content: trimmed, createdAt: Date.now() });
    addMessage({ id: assistantId, role: "assistant", content: "", createdAt: Date.now(), streaming: true });
    setStreaming(true);
    setInput("");

    const payload: ChatRequest = { question: trimmed };

    try {
      await streamChat(payload, (evt: ChatEvent) => {
        if (evt.error) {
          setError(evt.error);
          updateMessage(assistantId, { content: evt.error, streaming: false });
          return;
        }
        if (evt.result) {
          const content = formatResult(evt.result);
          updateMessage(assistantId, { content, streaming: false });
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send message";
      setError(msg);
      updateMessage(assistantId, { content: msg, streaming: false });
    } finally {
      setStreaming(false);
    }
  }

  function handleNewChat() {
    resetMessages();
    setActiveSession(undefined);
    setInput("");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      <aside
        className={`$${""} ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0 fixed md:static inset-y-0 left-0 z-20 w-64 bg-white border-r border-slate-200 shadow-sm md:shadow-none transition-transform duration-200 ease-out flex flex-col`}
      >
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200">
          <span className="font-semibold">Sessions</span>
          <button
            className="md:hidden text-sm text-slate-500"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setActiveSession(s.id);
                setSidebarOpen(false);
              }}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 ${
                s.id === activeSessionId ? "bg-slate-100" : ""
              }`}
            >
              <div className="font-medium line-clamp-1">{s.title}</div>
              <div className="text-xs text-slate-500">{s.time ?? ""}</div>
            </button>
          ))}
        </div>
        <div className="p-4 border-t border-slate-200">
          <button
            onClick={handleNewChat}
            className="w-full rounded-lg bg-slate-900 text-white py-2.5 text-sm font-semibold hover:bg-slate-800 transition"
          >
            + New chat
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-h-screen">
        <header className="flex items-center justify-between px-4 md:px-6 h-14 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="Toggle sidebar"
            >
              ☰
            </button>
            <div>
              <div className="text-sm font-semibold">{sessionTitle}</div>
              <div className="text-xs text-slate-500">Grounded answers, quizzes, grading</div>
            </div>
          </div>
          {streaming && <div className="text-xs font-semibold text-amber-600">Streaming…</div>}
        </header>

        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-3xl rounded-2xl border px-4 py-3 shadow-sm ${
                m.role === "user"
                  ? "bg-slate-900 text-white border-slate-900 ml-auto"
                  : "bg-white text-slate-900 border-slate-200"
              }`}
            >
              <div className="text-xs font-semibold mb-1 uppercase tracking-wide text-slate-500">
                {m.role === "user" ? "You" : "Assistant"}
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">
                {m.streaming ? "…" : m.content}
              </div>
            </div>
          ))}
          {messages.length === 0 && (
            <div className="text-sm text-slate-500">Ask anything about your notes to get started.</div>
          )}
          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>

        <div className="border-t border-slate-200 bg-white px-4 md:px-6 py-3">
          <div className="flex gap-3 max-w-4xl">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-200"
              placeholder="Ask a question or request a quiz..."
              aria-label="Chat input"
              disabled={streaming}
            />
            <button
              onClick={handleSend}
              disabled={streaming || input.trim().length === 0}
              className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-semibold shadow-sm hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
