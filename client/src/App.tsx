import { useEffect, useMemo, useRef, useState } from "react";
import { ChatInput } from "./components/ChatInput";
import {
  evaluateQuizAttempt,
  fetchSession,
  listSessions,
  streamChat,
  type ChatEvent,
  type ChatRequest,
} from "./lib/api";
import { useChatStore, type Message, type Role } from "./lib/store";

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
    quizQuestions,
    quizResult,
    quizAttemptId,
    setSessions,
    setActiveSession,
    setMessages,
    addMessage,
    updateMessage,
    appendMessage,
    setStreaming,
    resetMessages,
    setQuizState,
    clearQuiz,
  } = useChatStore();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [grading, setGrading] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

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
    setQuizAnswers((prev) => {
      const next: Record<string, string> = {};
      quizQuestions.forEach((q) => {
        next[q.questionId] = prev[q.questionId] ?? "";
      });
      return next;
    });
  }, [quizQuestions]);

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
    } else {
      setError(result.error ?? "Failed to load session");
    }
    setLoadingSessionId(null);
  }

  async function handleSend(text: string, level: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setError(null);
    setStatusNote("Thinking…");
    clearQuiz();

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
      await streamChat(payload, (evt: ChatEvent) => {
        if (evt.error) {
          setError(evt.error);
          updateMessage(assistantId, { content: evt.error, streaming: false });
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
            setQuizState({ questions, attemptId: evt.result.attemptId });
            updateMessage(assistantId, {
              content: `Generated a ${questions.length}-question quiz. Fill it out below.`,
              streaming: false,
            });
            return;
          }
          if (isQuizEvaluation(evt.result)) {
            setQuizState({
              questions: quizQuestions,
              attemptId: evt.result.attemptId ?? quizAttemptId,
              result: {
                attemptId: evt.result.attemptId ?? quizAttemptId,
                score: evt.result.score,
                feedback: (evt.result.feedback || []).map((f) => ({
                  questionId: f.questionId,
                  result: f.result ?? "Pending",
                  explanation: f.explanation,
                })),
                weakAreas: evt.result.weakAreas,
              },
            });
            updateMessage(assistantId, {
              content: `Quiz graded. Score: ${Math.round((evt.result.score ?? 0) * 100) / 100}%`,
              streaming: false,
            });
            return;
          }

          const content = formatResult(evt.result);
          appendMessage(assistantId, content);
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send message";
      setError(msg);
      updateMessage(assistantId, { content: msg, streaming: false });
    } finally {
      setStreaming(false);
      updateMessage(assistantId, { streaming: false });
      setStatusNote(null);
    }
  }

  function handleNewChat() {
    resetMessages();
    setActiveSession(undefined);
    clearQuiz();
  }

  async function handleQuizSubmit() {
    if (!quizAttemptId) {
      setError("Generate a quiz first.");
      return;
    }
    const responses = quizQuestions.map((q) => ({
      questionId: q.questionId,
      answer: (quizAnswers[q.questionId] || "").trim(),
    }));
    setGrading(true);
    setError(null);
    const result = await evaluateQuizAttempt(quizAttemptId, responses);
    setGrading(false);
    if (!result.ok || !result.result) {
      setError(result.error ?? "Failed to grade quiz");
      return;
    }
    setQuizState({
      questions: quizQuestions,
      attemptId: result.result.attemptId ?? quizAttemptId,
      result: {
        attemptId: result.result.attemptId ?? quizAttemptId,
        score: result.result.score,
        feedback: (result.result.feedback || []).map((f) => ({
          questionId: f.questionId,
          result: f.result ?? "Pending",
          explanation: f.explanation,
        })),
        weakAreas: result.result.weakAreas,
      },
    });
    addMessage({
      id: crypto.randomUUID(),
      role: "assistant",
      content: `Quiz graded. Score: ${Math.round((result.result.score ?? 0) * 100) / 100}%`,
      createdAt: Date.now(),
    });
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 flex">
      <aside
        className={`${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0 fixed md:static inset-y-0 left-0 z-20 w-72 bg-slate-900/70 backdrop-blur border-r border-slate-800 shadow-2xl md:shadow-none transition-transform duration-200 ease-out flex flex-col`}
      >
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-800">
          <span className="font-semibold">Sessions</span>
          <button
            className="md:hidden text-sm text-slate-400"
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
              className={`w-full text-left px-4 py-3 border-b border-slate-800/80 hover:bg-slate-800/60 transition ${
                s.id === activeSessionId ? "bg-slate-800" : ""
              }`}
            >
              <div className="font-medium line-clamp-1">{s.title}</div>
              <div className="text-xs text-slate-500">
                {loadingSessionId === s.id ? "Loading…" : (s.time ?? "")}
              </div>
            </button>
          ))}
        </div>
        <div className="p-4 border-t border-slate-800">
          <button
            onClick={handleNewChat}
            className="w-full rounded-lg bg-emerald-500 text-slate-950 py-2.5 text-sm font-semibold hover:bg-emerald-400 transition"
          >
            + New chat
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-h-screen">
        <header className="flex items-center justify-between px-4 md:px-6 h-14 border-b border-slate-800 bg-slate-900/70 backdrop-blur">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="Toggle sidebar"
            >
              ☰
            </button>
            <div>
              <div className="text-sm font-semibold">{sessionTitle}</div>
              <div className="text-xs text-slate-500">
                Grounded answers, quizzes, grading
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs font-semibold text-amber-400">
            {statusNote && <span className="animate-pulse">{statusNote}</span>}
            {streaming && (
              <span className="px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/30">
                Streaming…
              </span>
            )}
          </div>
        </header>

        <div
          className="flex-1 overflow-y-auto px-4 md:px-6 py-4"
          ref={messagesEndRef}
        >
          <div className="max-w-4xl mx-auto space-y-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-3xl rounded-2xl border px-4 py-3 shadow-sm ${
                  m.role === "user"
                    ? "bg-slate-100 text-slate-900 border-slate-200 ml-auto"
                    : "bg-slate-900/60 text-slate-50 border-slate-800"
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
              <div className="text-sm text-slate-400 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                Ask anything about your notes, request a quiz, or paste quiz
                answers to grade them.
              </div>
            )}

            {quizQuestions.length > 0 && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">
                      Quiz ready ({quizQuestions.length} questions)
                    </div>
                    <div className="text-xs text-slate-400">
                      Generated from your notes. Fill answers then grade.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearQuiz}
                    className="text-xs rounded-lg border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800"
                  >
                    Clear quiz
                  </button>
                </div>

                <div className="space-y-4">
                  {quizQuestions.map((q, idx) => {
                    const feedback = quizResult?.feedback?.find(
                      (f) => f.questionId === q.questionId,
                    );
                    const resultBadge = feedback?.result;
                    return (
                      <div
                        key={q.questionId}
                        className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2"
                      >
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                          <span className="text-xs text-slate-500">
                            Q{idx + 1}
                          </span>
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
                                  quizAnswers[q.questionId] === opt
                                    ? "border-emerald-400 bg-emerald-500/10"
                                    : "border-slate-800 hover:border-slate-700"
                                }`}
                              >
                                <input
                                  type="radio"
                                  name={q.questionId}
                                  value={opt}
                                  className="mr-2 accent-emerald-500"
                                  checked={quizAnswers[q.questionId] === opt}
                                  onChange={(e) =>
                                    setQuizAnswers((prev) => ({
                                      ...prev,
                                      [q.questionId]: e.target.value,
                                    }))
                                  }
                                  disabled={grading}
                                />
                                {opt}
                              </label>
                            ))}
                          </div>
                        ) : (
                          <textarea
                            className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                            rows={2}
                            placeholder="Type your short answer"
                            value={quizAnswers[q.questionId] || ""}
                            onChange={(e) =>
                              setQuizAnswers((prev) => ({
                                ...prev,
                                [q.questionId]: e.target.value,
                              }))
                            }
                            disabled={grading}
                          />
                        )}
                        {resultBadge && (
                          <div
                            className={`text-xs font-semibold inline-flex items-center gap-2 rounded-full px-3 py-1 border ${
                              resultBadge === "Correct"
                                ? "border-emerald-500 text-emerald-300"
                                : "border-amber-500 text-amber-300"
                            }`}
                          >
                            {resultBadge}
                            {feedback?.explanation && (
                              <span className="text-slate-400 font-normal">
                                {feedback.explanation}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between gap-3">
                  {quizResult?.score !== undefined ? (
                    <div className="text-sm text-emerald-300 font-semibold">
                      Score: {Math.round((quizResult.score ?? 0) * 100) / 100}%
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400">
                      Answer everything, then grade.
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleQuizSubmit}
                    disabled={grading}
                    className="rounded-xl bg-emerald-500 text-slate-950 px-4 py-2 text-sm font-semibold shadow hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {grading ? "Grading…" : "Submit answers"}
                  </button>
                </div>

                {quizResult?.weakAreas && quizResult.weakAreas.length > 0 && (
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-200 space-y-2">
                    <div className="font-semibold">Weak areas</div>
                    <ul className="list-disc pl-4 space-y-1">
                      {quizResult.weakAreas.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {error && <div className="text-sm text-red-400">{error}</div>}
            <div ref={scrollAnchorRef} />
          </div>
        </div>

        <div className="border-t border-slate-800 bg-slate-900/80 px-4 md:px-6 py-3">
          <div className="max-w-4xl mx-auto">
            <ChatInput
              disabled={streaming}
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
