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
            className={`max-w-3xl rounded-2xl border px-4 py-3 shadow-[0_12px_28px_rgba(0,0,0,0.32)] transition ${
              m.role === "user"
                ? "bg-[#0b1f35] text-[#e5e7eb] border-[#38bdf8] ml-auto"
                : "bg-[#0f172a] text-[#e5e7eb] border-[#1e293b]"
            }`}
          >
            <div className="text-[13px] font-semibold mb-1 uppercase tracking-wide text-[#9ca3af]">
              {m.role === "user" ? "You" : "Assistant"}
            </div>
            <div className="whitespace-pre-wrap text-[18px] leading-7 text-[#e5e7eb]">
              {m.streaming ? "…" : m.content}
            </div>
          </div>
        ))}
        {filteredMessages.length === 0 && (
          <div className="text-[16px] text-[#9ca3af] rounded-xl border border-[#1e293b] bg-[#0f172a] p-5 shadow-[0_8px_20px_rgba(0,0,0,0.28)]">
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
        <div className="rounded-2xl border border-[#1e293b] bg-[#0f172a] shadow-[0_12px_28px_rgba(0,0,0,0.32)] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[18px] font-semibold text-[#e5e7eb]">
                Quiz ready ({activeQuiz.questions.length} questions)
              </div>
              <div className="text-[16px] text-[#9ca3af]">
                Generated from your notes. Fill answers then grade.
              </div>
            </div>
            <button
              type="button"
              onClick={clearQuiz}
              className="text-xs rounded-lg px-3 py-1 border border-[#38bdf8] text-[#e5e7eb] bg-transparent hover:bg-[#111827] transition"
            >
              Back to chat
            </button>
          </div>

          <div className="space-y-4">
            {activeQuiz.questions.map((q, idx) => (
              <div
                key={q.questionId}
                className="rounded-xl border border-[#1e293b] bg-[#111827] p-4 space-y-2"
              >
                <div className="flex items-center gap-2 text-[17px] font-semibold text-[#e5e7eb]">
                  <span className="text-[14px] text-[#9ca3af]">Q{idx + 1}</span>
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
                            ? "border-[#38bdf8] bg-[#0f172a] text-[#e5e7eb] shadow-[0_4px_16px_rgba(56,189,248,0.16)]"
                            : "border-[#1e293b] bg-[#0f172a] text-[#e5e7eb] hover:border-[#38bdf8]"
                        }`}
                      >
                        <input
                          type="radio"
                          name={q.questionId}
                          value={opt}
                          className="mr-2 accent-[#38bdf8]"
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
                    className="w-full rounded-lg border border-[#1e293b] bg-[#0f172a] px-3 py-2 text-[17px] text-[#e5e7eb] placeholder:text-[#9ca3af] focus:border-[#38bdf8] focus:ring-2 focus:ring-[#38bdf8]/60"
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
            <div className="text-[16px] text-[#9ca3af]">
              Answer everything, then grade.
            </div>
            <button
              type="button"
              onClick={handleQuizSubmit}
              disabled={grading}
              className="rounded-xl text-[#020617] px-4 py-2 text-sm font-semibold shadow disabled:opacity-60 disabled:cursor-not-allowed bg-[#38bdf8] border border-[#38bdf8] hover:bg-[#5cc9ff] transition"
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
        <div className="rounded-2xl border border-[#1e293b] bg-[#0f172a] shadow-[0_12px_28px_rgba(0,0,0,0.32)] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[18px] font-semibold text-[#e5e7eb]">
                Quiz results
              </div>
              <div className="text-[16px] text-[#9ca3af]">
                Grounded answers from your notes.
              </div>
            </div>
            <button
              type="button"
              onClick={clearQuiz}
              className="text-xs rounded-lg px-3 py-1 border border-[#38bdf8] text-[#e5e7eb] bg-transparent hover:bg-[#111827] transition"
            >
              Back to chat
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-[28px] font-extrabold text-[#e5e7eb]">
              {Math.round((quizResult.score ?? 0) * 100) / 100}%
            </div>
            <div className="text-[16px] text-[#9ca3af]">Final score</div>
          </div>

          {weakAreas.length > 0 && (
            <div className="space-y-2">
              <div className="text-[16px] font-semibold text-[#e5e7eb]">
                Weak areas
              </div>
              <div className="flex flex-wrap gap-2">
                {weakAreas.map((w) => (
                  <span
                    key={w}
                    className="text-[14px] rounded-full px-3 py-1 border border-[#1e293b] bg-[#111827] text-[#e5e7eb]"
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
                className="rounded-xl border border-[#1e293b] bg-[#111827] p-3 space-y-1"
              >
                <div className="flex items-center justify-between text-[17px] font-semibold">
                  <span className="text-[#e5e7eb]">Question</span>
                  <span className="text-[14px] rounded-full px-2 py-1 border border-[#1e293b] bg-[#0f172a] text-[#e5e7eb]">
                    {f.result ?? "Pending"}
                  </span>
                </div>
                {f.explanation && (
                  <div className="text-[16px] text-[#9ca3af] leading-relaxed">
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

  // Dark, modern shell using the prescribed palette
  return (
    <div
      className="h-screen overflow-hidden bg-[#0f172a] text-[#e5e7eb]"
      style={{
        fontFamily:
          'Inter, "SF Pro Display", "Segoe UI", system-ui, -apple-system, "Segoe UI Emoji", sans-serif',
        fontSize: "18px",
        lineHeight: "26px",
        fontWeight: 500,
      }}
    >
      <aside
        className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 fixed inset-y-0 left-0 z-20 w-72 bg-[#020617] border-r border-[#1e293b] transition-transform duration-200 ease-out flex flex-col overflow-hidden shadow-[8px_0_24px_rgba(0,0,0,0.45)]`}
      >
        <div className="flex items-center justify-between px-4 h-14 border-b border-[#1e293b] bg-[#020617]">
          <span className="font-semibold text-[#e5e7eb]">History</span>
          <button
            className="md:hidden text-sm text-[#9ca3af] hover:text-[#e5e7eb]"
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
              className={`w-full text-left px-4 py-3 border-b border-[#1e293b] transition ${
                s.id === activeSessionId
                  ? "bg-[#111827] border-l-2 border-l-[#38bdf8]"
                  : "hover:bg-[#0f172a]"
              } text-[#e5e7eb]`}
            >
              <div className="font-medium line-clamp-1">{s.title}</div>
              <div className="text-xs text-[#9ca3af]">
                {loadingSessionId === s.id ? "Loading…" : (s.time ?? "")}
              </div>
            </button>
          ))}
        </div>
        <div className="p-4 border-t border-[#1e293b] bg-[#020617]">
          <button
            onClick={handleNewChat}
            className="w-full rounded-lg py-2.5 text-sm font-semibold text-[#020617] bg-[#38bdf8] border border-[outline-2#38bdf8] hover:bg-[#5cc9ff] transition focus-visible:outline  focus-visible:outline-offset-2 focus-visible:outline-[#38bdf8]"
          >
            + New chat
          </button>
        </div>
      </aside>
      <main className="ml-0 md:ml-72 flex flex-col h-screen bg-[#111827] overflow-hidden">
        <header className="sticky top-0 z-20 px-4 md:px-6 py-4 border-b border-[#1e293b] bg-[#020617] backdrop-blur-sm shadow-[0_10px_30px_rgba(0,0,0,0.4)]">
          <div className="flex flex-wrap items-center justify-between gap-4 md:gap-8">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111827] ring-2 ring-[#1e293b]"
              >
                <span className="h-2 w-2 rounded-full bg-[#38bdf8]" />
              </span>
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[24px] md:text-[26px] font-semibold text-[#e5e7eb] tracking-tight">
                    Qesem
                  </span>
                  {/* <span className="text-xs px-2 py-1 rounded-full bg-[#111827] border border-[#1e293b] text-[#9ca3af] uppercase tracking-[0.08em]">
                    Study
                  </span> */}
                </div>
                <div className="text-[18px] md:text-[19px] leading-7 text-[#9ca3af] truncate">
                  {lastUserPrompt}
                </div>
                {/* <div className="text-[15px] text-[#9ca3af]">
                  Grounded answers, quizzes, grading
                </div> */}
              </div>
            </div>
            <div className="flex items-center gap-3 md:gap-4">
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
                className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-semibold text-[#020617] bg-[#38bdf8] border border-[#38bdf8] hover:bg-[#5cc9ff] disabled:opacity-60 transition focus-visible:outline  focus-visible:outline-offset-2 focus-visible:outline-[#38bdf8]"
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
              {streaming && (
                <span className="text-xs rounded-full px-2.5 py-1 bg-[#111827] border border-[#38bdf8] text-[#e5e7eb]">
                  Streaming…
                </span>
              )}
              {statusNote && (
                <span className="text-xs font-medium text-[#9ca3af]">
                  {statusNote}
                </span>
              )}
            </div>
          </div>
        </header>

        <div
          className="flex-1 overflow-y-auto px-4 md:px-6 py-4 bg-[#111827]"
          ref={messagesEndRef}
        >
          {renderChatMessages()}
          {renderQuizCard()}
          {renderResultsCard()}
          {error && (
            <div className="max-w-3xl mx-auto text-sm text-[#ef4444] mt-4">
              {error}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[#1e293b] bg-[#020617] px-4 md:px-6 py-3">
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
