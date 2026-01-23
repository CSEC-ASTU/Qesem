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
    addMessage({
      id: crypto.randomUUID(),
      role: "assistant",
      content: `Uploaded successfully. Indexed ${result.saved ?? 0} chunks from ${file.name}.`,
      createdAt: Date.now(),
    });
  }

  async function handleSend(text: string, level: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setError(null);
    setStatusNote("Thinking…");
    clearQuiz();

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
    persistedCountRef.current = 0;
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
    <div className="min-h-screen bg-slate-100 text-slate-900 flex">
      <aside
        className={`${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0 fixed md:static inset-y-0 left-0 z-20 w-72 bg-white border-r border-slate-200 shadow-lg md:shadow-none transition-transform duration-200 ease-out flex flex-col`}
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

      <main className="flex-1 flex flex-col min-h-screen bg-slate-50">
        <header
          className="flex items-center justify-between px-4 md:px-6 h-14 border-b"
          style={{
            backgroundColor: BRAND,
            borderColor: "transparent",
            color: "#fff",
          }}
        >
          <div className="flex items-center gap-3">
            <button
              className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-lg border"
              style={{ borderColor: "rgba(255,255,255,0.4)", color: "#fff" }}
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
                <span
                  className="text-sm font-extrabold"
                  style={{ color: "#fff" }}
                >
                  Qesem
                </span>
              </div>
              <div>
                <div
                  className="text-sm font-semibold"
                  style={{ color: "#fff" }}
                >
                  {sessionTitle}
                </div>
                <div className="text-xs" style={{ color: "#e5e7eb" }}>
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
              className="inline-flex items-center gap-2 rounded-lg px-3 py-1 disabled:opacity-50"
              style={{
                border: "1px solid rgba(255,255,255,0.5)",
                color: "#fff",
              }}
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
              <span className="animate-pulse" style={{ color: "#fff" }}>
                {statusNote}
              </span>
            )}
            {streaming && (
              <span
                className="px-2 py-1 rounded-full"
                style={{
                  backgroundColor: "rgba(255,255,255,0.12)",
                  border: "1px solid rgba(255,255,255,0.3)",
                  color: "#fff",
                }}
              >
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
                    ? "bg-white text-slate-900 border-slate-200 ml-auto"
                    : "bg-slate-100 text-slate-900 border-slate-200"
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
              <div className="text-sm text-slate-600 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                Ask anything about your notes, request a quiz, or paste quiz
                answers to grade them.
              </div>
            )}

            {quizQuestions.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-lg p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">
                      Quiz ready ({quizQuestions.length} questions)
                    </div>
                    <div className="text-xs text-slate-500">
                      Generated from your notes. Fill answers then grade.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearQuiz}
                    className="text-xs rounded-lg border border-slate-200 px-3 py-1 text-slate-600 hover:bg-slate-100"
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
                        className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2"
                      >
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
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
                                    ? "border-emerald-400 bg-emerald-50"
                                    : "border-slate-200 hover:border-slate-300"
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
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
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
                                ? "border-emerald-500 text-emerald-700 bg-emerald-50"
                                : "border-amber-500 text-amber-700 bg-amber-50"
                            }`}
                          >
                            {resultBadge}
                            {feedback?.explanation && (
                              <span className="text-slate-600 font-normal">
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
                    <div className="text-sm text-emerald-700 font-semibold">
                      Score: {Math.round((quizResult.score ?? 0) * 100) / 100}%
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">
                      Answer everything, then grade.
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleQuizSubmit}
                    disabled={grading}
                    className="rounded-xl text-white px-4 py-2 text-sm font-semibold shadow disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ backgroundColor: BRAND }}
                  >
                    {grading ? "Grading…" : "Submit answers"}
                  </button>
                </div>

                {quizResult?.weakAreas && quizResult.weakAreas.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-2">
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

        <div className="border-t border-slate-200 bg-white px-4 md:px-6 py-3">
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
