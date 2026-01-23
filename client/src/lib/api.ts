import { z } from "zod";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

function buildUrl(pathname: string): string {
  return new URL(pathname, API_BASE).toString();
}

const RawSessionSchema = z.object({
  _id: z.string().optional(),
  id: z.string().optional(),
  topic: z.string().optional(),
  summary: z.string().optional(),
  createdAt: z.string().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
        createdAt: z.union([z.string(), z.number(), z.date()]).optional(),
      })
    )
    .optional(),
});

export type Session = {
  id: string;
  title: string;
  time?: string;
};

export type SessionMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

const SessionsResponseSchema = z.object({
  ok: z.boolean(),
  sessions: z.array(RawSessionSchema).optional(),
  error: z.string().optional(),
});

const SessionResponseSchema = z.object({
  ok: z.boolean(),
  session: RawSessionSchema.optional(),
  error: z.string().optional(),
});

export const ChatRequestSchema = z.object({
  question: z.string().optional(),
  topic: z.string().optional(),
  level: z.string().optional(),
  attemptId: z.string().optional(),
  responses: z
    .array(
      z.object({
        questionId: z.string(),
        answer: z.string(),
      })
    )
    .optional(),
  questionCount: z.number().optional(),
  mode: z.string().optional(),
  stream: z.boolean().optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatResponseSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  retrieved: z.array(z.unknown()).optional(),
  mode: z.string().optional(),
  error: z.string().optional(),
});

export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const ChatEventSchema = z
  .object({
    type: z.string(),
    message: z.string().optional(),
    token: z.string().optional(),
    questions: z.array(z.unknown()).optional(),
    sources: z.array(z.unknown()).optional(),
    result: z.unknown().optional(),
    retrieved: z.array(z.unknown()).optional(),
    mode: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export type ChatEvent = z.infer<typeof ChatEventSchema>;

const QuizEvaluationResponseSchema = z.object({
  ok: z.boolean(),
  attemptId: z.string().optional(),
  score: z.number().optional(),
  weakAreas: z.array(z.string()).optional(),
  feedback: z
    .array(
      z.object({
        questionId: z.string(),
        result: z.string().optional(),
        explanation: z.string().optional(),
      })
    )
    .optional(),
  questions: z
    .array(
      z.object({
        questionId: z.string(),
        result: z.string().optional(),
        feedback: z.string().optional(),
      })
    )
    .optional(),
  error: z.string().optional(),
});

export type QuizEvaluationResponse = z.infer<typeof QuizEvaluationResponseSchema>;

async function safeFetch<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  schema: z.ZodSchema<T>
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(input, init);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      return { ok: false, error: text?.slice(0, 120) || "Invalid response (expected JSON)" };
    }

    const json = await res.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, error: "Invalid response shape" };
    }
    return { ok: true, data: parsed.data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    return { ok: false, error: msg };
  }
}

export async function listSessions(): Promise<{ ok: boolean; sessions: Session[]; error?: string }> {
  const result = await safeFetch(buildUrl("/sessions"), { method: "GET" }, SessionsResponseSchema);
  if (!result.ok) return { ok: false, sessions: [], error: result.error };
  const sessions = (result.data.sessions ?? []).map<Session>((s) => ({
    id: s.id ?? s._id ?? crypto.randomUUID(),
    title: s.topic ?? "Untitled session",
    time: s.createdAt,
  }));
  return { ok: true, sessions };
}

export async function fetchSession(
  id: string
): Promise<{ ok: boolean; session?: { id: string; title: string; time?: string; messages: SessionMessage[] }; error?: string }> {
  const result = await safeFetch(buildUrl(`/sessions/${id}`), { method: "GET" }, SessionResponseSchema);
  if (!result.ok || !result.data.session) {
    return { ok: false, error: result.ok ? "Session not found" : result.error };
  }

  const messages: SessionMessage[] = (result.data.session.messages ?? []).map((m) => ({
    role: m.role,
    content: m.content,
    createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : new Date().toISOString(),
  }));

  return {
    ok: true,
    session: {
      id: result.data.session.id ?? result.data.session._id ?? id,
      title: result.data.session.topic ?? "Untitled session",
      time: result.data.session.createdAt,
      messages,
    },
  };
}

export async function sendChat(payload: ChatRequest): Promise<{ ok: boolean; response?: ChatResponse; error?: string }> {
  const validated = ChatRequestSchema.safeParse(payload);
  if (!validated.success) {
    return { ok: false, error: "Invalid chat payload" };
  }
  const result = await safeFetch(
    buildUrl("/chat"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validated.data),
    },
    ChatResponseSchema
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, response: result.data };
}

export async function streamChat(
  payload: ChatRequest,
  onEvent: (evt: ChatEvent) => void,
  options?: { signal?: AbortSignal }
): Promise<void> {
  const validated = ChatRequestSchema.safeParse({ ...payload, stream: true });
  if (!validated.success) {
    throw new Error("Invalid chat payload");
  }

  const res = await fetch(buildUrl("/chat?stream=true"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validated.data),
    signal: options?.signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const chunk of parts) {
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      const payloadStr = line.replace(/^data:\s*/, "");
      try {
        const parsedJson = JSON.parse(payloadStr);
        const evtParsed = ChatEventSchema.safeParse(parsedJson);
        if (evtParsed.success) {
          onEvent(evtParsed.data);
        }
      } catch {
        // ignore malformed events
      }
    }
  }
}

export async function evaluateQuizAttempt(
  attemptId: string,
  responses: Array<{ questionId: string; answer: string }>
): Promise<{ ok: boolean; result?: QuizEvaluationResponse; error?: string }> {
  const payload = { attemptId, responses };
  const result = await safeFetch(
    buildUrl("/quiz/auto/evaluate"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    QuizEvaluationResponseSchema
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, result: result.data };
}

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  createdAt: z.union([z.string(), z.number(), z.date()]).optional(),
});

const SessionMutationResponseSchema = z.object({
  ok: z.boolean(),
  session: RawSessionSchema.optional(),
  error: z.string().optional(),
});

export async function createSession(payload: {
  topic?: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string; createdAt?: string | number | Date }>;
  summary?: unknown;
}): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  const messagesParsed = z.array(ChatMessageSchema).safeParse(payload.messages);
  if (!messagesParsed.success) return { ok: false, error: "Invalid messages" };

  const result = await safeFetch(
    buildUrl("/sessions"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: payload.topic, messages: messagesParsed.data, summary: payload.summary }),
    },
    SessionMutationResponseSchema
  );
  if (!result.ok || !result.data.session) return { ok: false, error: result.ok ? "Session create failed" : result.error };
  const id = result.data.session.id ?? result.data.session._id;
  return id ? { ok: true, sessionId: id } : { ok: false, error: "Missing session id" };
}

export async function appendSession(
  id: string,
  messages: Array<{ role: "user" | "assistant" | "system"; content: string; createdAt?: string | number | Date }>
): Promise<{ ok: boolean; error?: string }> {
  const messagesParsed = z.array(ChatMessageSchema).safeParse(messages);
  if (!messagesParsed.success) return { ok: false, error: "Invalid messages" };

  const result = await safeFetch(
    buildUrl(`/sessions/${id}/resume`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: messagesParsed.data }),
    },
    SessionMutationResponseSchema
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}
