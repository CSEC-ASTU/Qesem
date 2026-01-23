// import { z } from "zod";
import { ChatRequestSchema as ChatEventSchema } from "./api";

export type SseChatCallbacks = {
  onToken?: (token: string) => void;
  onStep?: (step: string | Record<string, unknown>) => void;
  onQuiz?: (quiz: unknown) => void;
  onDone?: (payload: unknown) => void;
  onError?: (error: string) => void;
  
};

export async function sseChat(
  payload: Record<string, unknown>,
  callbacks: SseChatCallbacks
): Promise<void> {
  const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
  const url = new URL("/chat?stream=true", API_BASE).toString();

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, stream: true }),
  });

  if (!res.ok || !res.body) {
    callbacks.onError?.(`HTTP ${res.status}`);
    return;
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
        if (!evtParsed.success) continue;
        const evt = evtParsed.data;
        switch (evt.type) {
          case "AGENT_STEP":
            callbacks.onStep?.(evt.message ?? evt);
            break;
          case "ANSWER_TOKEN":
            if (typeof evt.token === "string") callbacks.onToken?.(evt.token);
            break;
          case "QUIZ":
            callbacks.onQuiz?.(evt.questions ?? evt);
            break;
          case "DONE":
            callbacks.onDone?.(evt);
            break;
          case "ERROR":
            callbacks.onError?.(evt.error ?? "Unknown error");
            break;
        }
      } catch {
        // ignore malformed events
      }
    }
  }
}