import { z } from "zod";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

function buildUrl(pathname: string): string {
  return new URL(pathname, API_BASE).toString();
}

const RawSessionSchema = z.object({
  _id: z.string().optional(),
  id: z.string().optional(),
  topic: z.string().optional(),
  summary: z.any().optional(),
  createdAt: z.string().optional(),
});

export type Session = {
  id: string;
  title: string;
  time?: string;
};

const SessionsResponseSchema = z.object({
  ok: z.boolean(),
  sessions: z.array(RawSessionSchema).optional(),
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

const ChatEventSchema = z.object({
  type: z.string(),
  result: z.unknown().optional(),
  retrieved: z.array(z.unknown()).optional(),
  mode: z.string().optional(),
  error: z.string().optional(),
});

export type ChatEvent = z.infer<typeof ChatEventSchema>;

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
  onEvent: (evt: ChatEvent) => void
): Promise<void> {
  const validated = ChatRequestSchema.safeParse({ ...payload, stream: true });
  if (!validated.success) {
    throw new Error("Invalid chat payload");
  }

  const res = await fetch(buildUrl("/chat?stream=true"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validated.data),
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
