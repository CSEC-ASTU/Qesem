import { useEffect, useMemo, useRef, useState } from "react";
import { ChatInput } from "./components/ChatInput";
import {
  evaluateQuizAttempt,
  fetchSession,
  listSessions,
  createSession,
  appendSession,
  streamChat,
  type ChatEvent,
  type ChatRequest,
} from "./lib/api";
import { useChatStore, type Message, type Role } from "./lib/store";
import { uploadNotes } from "./lib/api";

const BRAND = "#152737";

function formatResult(result: unknown): string {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (
    typeof result === "object" &&
    "answer" in (result as Record<string, unknown>)
  ) {
    const val = (result as { answer?: unknown }).answer;
    if (typeof val === "string") return val;
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

type QuizGenResult = {
  attemptId?: string;
  questions: Array<{
    questionId: string;
    prompt: string;
    type?: string;
    options?: string[];
  }>;
};

type QuizEvalResult = {
  attemptId?: string;
  score?: number;
  weakAreas?: string[];
  feedback?: Array<{
    questionId: string;
    result?: string;
    explanation?: string;
  }>;
};

function isQuizGeneration(result: unknown): result is QuizGenResult {
  if (!result || typeof result !== "object") return false;
  const record = result as { questions?: unknown };
  return Array.isArray(record.questions);
}

function isQuizEvaluation(result: unknown): result is QuizEvalResult {
  if (!result || typeof result !== "object") return false;
  const record = result as { score?: unknown; feedback?: unknown };
  return (
    typeof record.score === "number" ||
    Array.isArray(record.feedback as unknown[])
  );
}

function App() {
  const {
    messages,
    sessions,
    activeSessionId,
    streaming,
    uiMode,
    activeQuiz,
    quizResponses,
    quizResult,
    setSessions,
    setActiveSession,
    setMessages,
    addMessage,
    removeMessage,
    updateMessage,
    appendMessage,
    setStreaming,
    resetMessages,
    setUiMode,
    setActiveQuiz,
    setQuizResult,
    setQuizResponses,
    updateQuizResponse,
    clearQuiz,
  } = useChatStore();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [grading, setGrading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const persistedCountRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

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

  useEffect(() => {
    // Auto-scroll to bottom on new messages
    if (scrollAnchorRef.current) {
      scrollAnchorRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    if (activeQuiz?.questions) {
      const next: Record<string, string> = {};
      activeQuiz.questions.forEach((q) => {
        next[q.questionId] = quizResponses[q.questionId] ?? "";
      });
      setQuizResponses(next);
    } else {
      setQuizResponses({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuiz?.questions]);

  const sessionTitle = useMemo(() => {
    const session = sessions.find((s) => s.id === activeSessionId);
    return session?.title ?? "New chat";
  }, [sessions, activeSessionId]);

  async function handleSelectSession(id: string) {
    setLoadingSessionId(id);
    setActiveSession(id);
    setSidebarOpen(false);
    setError(null);
    clearQuiz();
    setUiMode("chat");
    const result = await fetchSession(id);
    if (result.ok && result.session) {
      const toRole = (role: string): Role =>
        role === "assistant" ? "assistant" : "user";
      const mapped: Message[] = result.session.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m, idx) => ({
          id: `${m.createdAt}-${idx}`,
          role: toRole(m.role),
          content: m.content,
          createdAt: new Date(m.createdAt).getTime(),
        }))
        .sort((a, b) => a.createdAt - b.createdAt);
      setMessages(mapped);
      persistedCountRef.current = mapped.length;
    } else {
      setError(result.error ?? "Failed to load session");
    }
    setLoadingSessionId(null);
  }

  async function handleUploadFile(file: File) {
    if (!file) return;
    setError(null);
    setStatusNote("Uploading notes…");
    setUploading(true);
    const isSupported =
      ["application/pdf", "text/plain"].includes(file.type) ||
      /\.pdf$/i.test(file.name) ||
      /\.txt$/i.test(file.name);
    if (!isSupported) {
      setError("Only PDF or TXT files are allowed");
      setStatusNote(null);
      setUploading(false);
      return;
    }
    const result = await uploadNotes(file);
    setUploading(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to upload");
      setStatusNote(null);
      return;
    }
    setStatusNote(null);
  }

  async function handleSend(text: string, level: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    if (uiMode !== "chat") {
      setError("Finish the current quiz or return to chat first.");
      return;
    }
    setError(null);
    setStatusNote("Thinking…");
    clearQuiz();
    setUiMode("chat");

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();

    addMessage({
      id: userId,
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    });
    addMessage({
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      streaming: true,
    });
    setStreaming(true);
    const payload: ChatRequest = { question: trimmed, level };

    try {
      await streamChat(
        payload,
        (evt: ChatEvent) => {
          if (evt.error) {
            setError(evt.error);
            updateMessage(assistantId, {
              content: evt.error,
              streaming: false,
            });
            return;
          }
          if (evt.type === "ANSWER_TOKEN" && typeof evt.token === "string") {
            appendMessage(assistantId, evt.token);
            return;
          }
          if (evt.type === "AGENT_STEP" && evt.message) {
            setStatusNote(
              typeof evt.message === "string"
                ? evt.message
                : "Working through your notes…",
            );
            return;
          }
          if (evt.result) {
            if (isQuizGeneration(evt.result)) {
              const questions = evt.result.questions.map((q) => ({
                questionId: q.questionId,
                prompt: q.prompt,
                type: q.type,
                options: q.options,
              }));
              setActiveQuiz({ questions, attemptId: evt.result.attemptId });
              setUiMode("quiz");
              removeMessage(assistantId);
              return;
            }
            if (isQuizEvaluation(evt.result)) {
              setQuizResult({
                attemptId: evt.result.attemptId,
                score: evt.result.score,
                feedback: (evt.result.feedback || []).map((f) => ({
                  questionId: f.questionId,
                  result: f.result ?? "Pending",
                  explanation: f.explanation,
                })),
                weakAreas: evt.result.weakAreas,
              });
              setUiMode("results");
              removeMessage(assistantId);
              return;
            }

            const content = formatResult(evt.result);
            appendMessage(assistantId, content);
          }
        },
        { signal: controller.signal },
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const msg = err instanceof Error ? err.message : "Failed to send message";
      setError(msg);
      updateMessage(assistantId, { content: msg, streaming: false });
    } finally {
      setStreaming(false);
      updateMessage(assistantId, { streaming: false });
      setStatusNote(null);
      abortRef.current = null;

      // Persist session/history
      const outboundMessages = useChatStore.getState().messages;
      const newMessages = outboundMessages.slice(persistedCountRef.current);
      if (newMessages.length > 0) {
        if (!activeSessionId) {
          const created = await createSession({
            topic: outboundMessages[0]?.content ?? "New chat",
            messages: outboundMessages.map((m) => ({
              role: m.role,
              content: m.content,
              createdAt: m.createdAt,
            })),
          });
          if (created.ok && created.sessionId) {
            setActiveSession(created.sessionId);
            setSessions([
              {
                id: created.sessionId,
                title: outboundMessages[0]?.content ?? "New chat",
                time: new Date().toISOString(),
              },
              ...sessions,
            ]);
            persistedCountRef.current = outboundMessages.length;
          } else if (created.error) {
            setError((prev) => prev ?? created.error ?? null);
          }
        } else {
          const appended = await appendSession(
            activeSessionId,
            newMessages.map((m) => ({
              role: m.role,
              content: m.content,
              createdAt: m.createdAt,
            })),
          );
          if (!appended.ok && appended.error) {
            setError((prev) => prev ?? appended.error ?? null);
          } else {
            persistedCountRef.current = outboundMessages.length;
          }
        }
      }
    }
  }

  function handleNewChat() {
    resetMessages();
    setActiveSession(undefined);
    clearQuiz();
    setUiMode("chat");
    persistedCountRef.current = 0;
  }

  async function handleQuizSubmit() {
    if (!activeQuiz?.attemptId) {
      setError("Generate a quiz first.");
      return;
    }
    const responses = (activeQuiz.questions || []).map((q) => ({
      questionId: q.questionId,
      answer: (quizResponses[q.questionId] || "").trim(),
    }));
    setGrading(true);
    setError(null);
    const result = await evaluateQuizAttempt(activeQuiz.attemptId, responses);
    setGrading(false);
    if (!result.ok || !result.result) {
      setError(result.error ?? "Failed to grade quiz");
      return;
    }
    setQuizResult({
      attemptId: result.result.attemptId ?? activeQuiz.attemptId,
      score: result.result.score,
      feedback: (result.result.feedback || []).map((f) => ({
        questionId: f.questionId,
        result: f.result ?? "Pending",
        explanation: f.explanation,
      })),
      weakAreas: result.result.weakAreas,
    });
    setUiMode("results");
  }

  const filteredMessages = messages.filter((m) => m.content.trim().length > 0);

  function renderChatMessages() {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        {filteredMessages.map((m) => (
          <div
            key={m.id}
            className={`max-w-3xl rounded-2xl border px-4 py-3 shadow-sm ${
              m.role === "user"
                ? "bg-white text-slate-900 border-slate-200 ml-auto"
                : "bg-slate-100 text-slate-900 border-slate-200"
            }`}
          >
            <div className="text-xs font-semibold mb-1 uppercase tracking-wide text-slate-500">
              {m.role === "user" ? "You" : "Assistant"}
            </div>
            <div className="whitespace-pre-wrap text-base leading-relaxed">
              {m.streaming ? "…" : m.content}
            </div>
          </div>
        ))}
        {filteredMessages.length === 0 && (
          <div className="text-sm text-slate-600 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            Ask anything about your notes, request a quiz, or paste quiz answers
            to grade them.
          </div>
        )}
        <div ref={scrollAnchorRef} />
      </div>
    );
  }

  function renderQuizCard() {
    if (uiMode !== "quiz" || !activeQuiz?.questions?.length) return null;
    return (
      <div className="max-w-3xl mx-auto mt-4 space-y-3">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">
                Quiz ready ({activeQuiz.questions.length} questions)
              </div>
              <div className="text-xs text-slate-500">
                Generated from your notes. Fill answers then grade.
              </div>
            </div>
            <button
              type="button"
              onClick={clearQuiz}
              className="text-xs rounded-lg px-3 py-1"
              style={{
                border: "1px solid var(--brand-border)",
                color: "var(--brand)",
                background: "var(--brand-bg-muted)",
              }}
            >
              Back to chat
            </button>
          </div>

          <div className="space-y-4">
            {activeQuiz.questions.map((q, idx) => (
              <div
                key={q.questionId}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <span className="text-xs text-slate-500">Q{idx + 1}</span>
                  <span>{q.prompt}</span>
                </div>
                {q.type === "mcq" &&
                Array.isArray(q.options) &&
                q.options.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {q.options.map((opt) => (
                      <label
                        key={opt}
                        className={`rounded-lg border px-3 py-2 text-sm cursor-pointer transition ${
                          quizResponses[q.questionId] === opt
                            ? "border-emerald-400 bg-emerald-50"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="radio"
                          name={q.questionId}
                          value={opt}
                          className="mr-2 accent-emerald-500"
                          checked={quizResponses[q.questionId] === opt}
                          onChange={(e) =>
                            updateQuizResponse(q.questionId, e.target.value)
                          }
                          disabled={grading}
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                ) : (
                  <textarea
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                    rows={2}
                    placeholder="Type your short answer"
                    value={quizResponses[q.questionId] || ""}
                    onChange={(e) =>
                      updateQuizResponse(q.questionId, e.target.value)
                    }
                    disabled={grading}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              Answer everything, then grade.
            </div>
            <button
              type="button"
              onClick={handleQuizSubmit}
              disabled={grading}
              className="rounded-xl text-white px-4 py-2 text-sm font-semibold shadow disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: "var(--brand)" }}
            >
              {grading ? "Grading…" : "Submit answers"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderResultsCard() {
    if (uiMode !== "results" || !quizResult) return null;
    const weakAreas = quizResult.weakAreas || [];
    const truncate = (s: string) => (s.length > 64 ? `${s.slice(0, 64)}…` : s);
    return (
      <div className="max-w-3xl mx-auto mt-4 space-y-3">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Quiz results</div>
              <div className="text-xs text-slate-500">
                Grounded answers from your notes.
              </div>
            </div>
            <button
              type="button"
              onClick={clearQuiz}
              className="text-xs rounded-lg px-3 py-1"
              style={{
                border: "1px solid var(--brand-border)",
                color: "var(--brand)",
                background: "var(--brand-bg-muted)",
              }}
            >
              Back to chat
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div
              className="text-3xl font-extrabold"
              style={{ color: "var(--brand)" }}
            >
              {Math.round((quizResult.score ?? 0) * 100) / 100}%
            </div>
            <div className="text-sm text-slate-600">Final score</div>
          </div>

          {weakAreas.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-700">
                Weak areas
              </div>
              <div className="flex flex-wrap gap-2">
                {weakAreas.map((w) => (
                  <span
                    key={w}
                    className="text-xs rounded-full px-3 py-1"
                    style={{
                      border: "1px solid var(--brand-border)",
                      background: "var(--brand-badge-bg)",
                      color: "var(--brand)",
                    }}
                  >
                    {truncate(w)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            {(quizResult.feedback || []).map((f) => (
              <div
                key={f.questionId}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1"
              >
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span>Question</span>
                  <span
                    className="text-xs rounded-full px-2 py-1"
                    style={{
                      border: "1px solid var(--brand-border)",
                      background: "var(--brand-badge-bg)",
                      color: "var(--brand)",
                    }}
                  >
                    {f.result ?? "Pending"}
                  </span>
                </div>
                {f.explanation && (
                  <div className="text-xs text-slate-700 leading-relaxed">
                    {f.explanation}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-slate-100 text-slate-900">
      <aside
        className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 fixed md:fixed inset-y-0 left-0 z-20 w-72 bg-white border-r border-slate-200 shadow-lg transition-transform duration-200 ease-out flex flex-col overflow-hidden`}
      >
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200">
          <span className="font-semibold">History</span>
          <button
            className="md:hidden text-sm text-slate-500"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            ✕
          </button>
        </div>
        <div className="flex-1">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                handleSelectSession(s.id);
              }}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition ${
                s.id === activeSessionId ? "bg-slate-100" : ""
              }`}
            >
              <div className="font-medium line-clamp-1">{s.title}</div>
              <div className="text-xs text-slate-500">
                {loadingSessionId === s.id ? "Loading…" : (s.time ?? "")}
              </div>
            </button>
          ))}
        </div>
        <div className="p-4 border-t border-slate-200">
          <button
            onClick={handleNewChat}
            className="w-full rounded-lg text-white py-2.5 text-sm font-semibold transition"
            style={{ backgroundColor: BRAND }}
          >
            + New chat
          </button>
        </div>
      </aside>

      <main className="ml-0 md:ml-72 flex flex-col h-screen bg-slate-50 overflow-hidden">
        <header className="flex items-center justify-between px-4 md:px-6 h-14 bg-[#152737] text-white">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/40 text-white"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="Toggle sidebar"
            >
              ☰
            </button>
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-6 w-6 rounded-full bg-white/20"
                />
                <span className="text-sm font-extrabold text-white">Qesem</span>
              </div>
              <div>
                <div className="text-sm font-semibold text-white/80">
                  {sessionTitle}
                </div>
                <div className="text-xs text-white/70">
                  Grounded answers, quizzes, grading
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs font-semibold text-amber-600">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,application/pdf,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUploadFile(f);
                // reset to allow re-select same file
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-1 border border-white/50 text-white disabled:opacity-50"
              aria-label="Upload notes (PDF/TXT)"
              title="Upload notes (PDF/TXT)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-4 w-4"
              >
                <path d="M4 20h16M12 4v12m0 0l-4-4m4 4l4-4" />
              </svg>
              <span>Upload</span>
            </button>
            {statusNote && (
              <span className="animate-pulse text-white">{statusNote}</span>
            )}
            {streaming && (
              <span className="px-2 py-1 rounded-full bg-white/10 border border-white/30 text-white">
                Streaming…
              </span>
            )}
          </div>
        </header>

        <div
          className="flex-1 overflow-y-auto px-4 md:px-6 py-4"
          ref={messagesEndRef}
        >
          {renderChatMessages()}
          {renderQuizCard()}
          {renderResultsCard()}
          {error && (
            <div className="max-w-3xl mx-auto text-sm text-red-400 mt-4">
              {error}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white px-4 md:px-6 py-3">
          <div className="max-w-4xl mx-auto">
            <ChatInput
              disabled={streaming || uiMode !== "chat"}
              onSend={({ text, level }) => handleSend(text, level)}
              placeholder="Explain a topic, generate a quiz, or grade answers..."
            />
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
