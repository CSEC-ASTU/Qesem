export type Intent = 'QUIZ' | 'EXPLAIN'

/**
 * Detect user intent from a request body.
 * Deterministic: only `mode === "quiz"` yields QUIZ; otherwise EXPLAIN.
 */
export function detectIntent(body: unknown): Intent {
  const mode = typeof (body as any)?.mode === 'string' ? (body as any).mode : undefined
  return mode === 'quiz' ? 'QUIZ' : 'EXPLAIN'
}
