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

  const lastUserPrompt = useMemo(() => {
    const u = messages.filter(
      (m) => m.role === "user" && m.content.trim().length > 0,
    );
    return u.length
      ? u[u.length - 1].content
      : "Ask anything about your notes, or request a quiz";
  }, [messages]);

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
                ? "bg-[#303030] text-white border-white/40 ml-auto"
                : "bg-[#212121] text-white border-white/20"
            }`}
          >
            <div className="text-xs font-semibold mb-1 uppercase tracking-wide text-white/60">
              {m.role === "user" ? "You" : "Assistant"}
            </div>
            <div className="whitespace-pre-wrap text-base leading-relaxed text-white">
              {m.streaming ? "…" : m.content}
            </div>
          </div>
        ))}
        {filteredMessages.length === 0 && (
          <div className="text-sm text-white/80 rounded-xl border border-white/30 bg-[#303030] p-4 shadow-sm">
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
        <div className="rounded-2xl border border-white bg-[#212121] shadow-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white">
                Quiz ready ({activeQuiz.questions.length} questions)
              </div>
              <div className="text-xs text-white/70">
                Generated from your notes. Fill answers then grade.
              </div>
            </div>
            <button
              type="button"
              onClick={clearQuiz}
              className="text-xs rounded-lg px-3 py-1 border border-white text-white bg-[#212121] hover:bg-[#303030]"
            >
              Back to chat
            </button>
          </div>

          <div className="space-y-4">
            {activeQuiz.questions.map((q, idx) => (
              <div
                key={q.questionId}
                className="rounded-xl border border-white/30 bg-[#303030] p-4 space-y-2"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <span className="text-xs text-white/60">Q{idx + 1}</span>
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
                            ? "border-white bg-[#212121] text-white"
                            : "border-white/30 bg-[#212121] hover:border-white text-white"
                        }`}
                      >
                        <input
                          type="radio"
                          name={q.questionId}
                          value={opt}
                          className="mr-2 accent-white"
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
                    className="w-full rounded-lg border border-white/30 bg-[#212121] px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-white focus:ring-1 focus:ring-white"
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
            <div className="text-xs text-white/70">
              Answer everything, then grade.
            </div>
            <button
              type="button"
              onClick={handleQuizSubmit}
              disabled={grading}
              className="rounded-xl text-white px-4 py-2 text-sm font-semibold shadow disabled:opacity-50 disabled:cursor-not-allowed bg-[#212121] border border-white hover:bg-[#303030]"
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
        <div className="rounded-2xl border border-white bg-[#212121] shadow-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white">
                Quiz results
              </div>
              <div className="text-xs text-white/70">
                Grounded answers from your notes.
              </div>
            </div>
            <button
              type="button"
              onClick={clearQuiz}
              className="text-xs rounded-lg px-3 py-1 border border-white text-white bg-[#212121] hover:bg-[#303030]"
            >
              Back to chat
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-3xl font-extrabold text-white">
              {Math.round((quizResult.score ?? 0) * 100) / 100}%
            </div>
            <div className="text-sm text-white/70">Final score</div>
          </div>

          {weakAreas.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-white">Weak areas</div>
              <div className="flex flex-wrap gap-2">
                {weakAreas.map((w) => (
                  <span
                    key={w}
                    className="text-xs rounded-full px-3 py-1 border border-white/30 bg-[#303030] text-white"
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
                className="rounded-xl border border-white/30 bg-[#303030] p-3 space-y-1"
              >
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span className="text-white">Question</span>
                  <span className="text-xs rounded-full px-2 py-1 border border-white/30 bg-[#212121] text-white">
                    {f.result ?? "Pending"}
                  </span>
                </div>
                {f.explanation && (
                  <div className="text-xs text-white/80 leading-relaxed">
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

  // Dark, minimal shell using the prescribed palette and white separators
  return (
    <div
      className="h-screen overflow-hidden bg-[#212121] text-white"
      style={{
        fontFamily:
          'ui-sans-serif, -apple-system, "system-ui", "Segoe UI", Helvetica, "Apple Color Emoji", Arial, "sans-serif", "Segoe UI Emoji", "Segoe UI Symbol"',
        fontSize: "20px",
        lineHeight: "28px",
        fontWeight: 600,
      }}
    >
      <aside
        className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 fixed inset-y-0 left-0 z-20 w-72 bg-[#212121] border-r border-white transition-transform duration-200 ease-out flex flex-col overflow-hidden`}
      >
        <div className="flex items-center justify-between px-4 h-14 border-b border-white">
          <span className="font-semibold text-white">History</span>
          <button
            className="md:hidden text-sm text-white hover:text-white/80"
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
                handleSelectSession(s.id);
              }}
              className={`w-full text-left px-4 py-3 border-b border-white/20 hover:bg-[#303030] transition ${
                s.id === activeSessionId ? "bg-[#303030]" : ""
              } text-white`}
            >
              <div className="font-medium line-clamp-1">{s.title}</div>
              <div className="text-xs text-white/70">
                {loadingSessionId === s.id ? "Loading…" : (s.time ?? "")}
              </div>
            </button>
          ))}
        </div>
        <div className="p-4 border-t border-white bg-[#212121]">
          <button
            onClick={handleNewChat}
            className="w-full rounded-lg py-2.5 text-sm font-semibold text-white bg-[#212121] border border-white hover:bg-[#303030] transition"
          >
            + New chat
          </button>
        </div>
      </aside>
      <main className="ml-0 md:ml-72 flex flex-col h-screen bg-[#212121] overflow-hidden">
        <header className="sticky top-0 z-20 px-4 md:px-6 py-4 border-b border-white bg-[#212121]">
          <div className="flex items-center justify-between">
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-7 w-7 rounded-full bg-[#303030] ring-2 ring-white/30"
                />
                <span className="text-lg md:text-xl font-semibold text-white tracking-tight">
                  Qesem
                </span>
              </div>
              <div className="text-sm md:text-base text-white/80 truncate">
                {lastUserPrompt}
              </div>
              <div className="text-xs md:text-sm text-white/60">
                Grounded answers, quizzes, grading
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,application/pdf,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUploadFile(f);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white border border-white bg-[#212121] hover:bg-[#303030] disabled:opacity-50"
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
                <span className="text-xs font-medium text-white/80">
                  {statusNote}
                </span>
              )}
              {streaming && (
                <span className="text-xs rounded-full px-2 py-1 bg-[#212121] border border-white text-white">
                  Streaming…
                </span>
              )}
            </div>
          </div>
        </header>

        <div
          className="flex-1 overflow-y-auto px-4 md:px-6 py-4 bg-[#212121]"
          ref={messagesEndRef}
        >
          {renderChatMessages()}
          {renderQuizCard()}
          {renderResultsCard()}
          {error && (
            <div className="max-w-3xl mx-auto text-sm text-red-300 mt-4">
              {error}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-white bg-[#303030] px-4 md:px-6 py-3">
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
