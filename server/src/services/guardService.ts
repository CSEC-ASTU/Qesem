import QuizAttempt from '../models/QuizAttempt.js'

export function ensureChunks(retrieved: any[], message: string) {
  if (!retrieved || retrieved.length === 0) {
    return { ok: false, error: message }
  }
  return null
}

export async function ensureAttempt(attemptId: string) {
  if (!attemptId) return { ok: false, error: 'Attempt not found' as const }
  const attempt = await QuizAttempt.findById(attemptId)
  if (!attempt) return { ok: false, error: 'Attempt not found' as const }
  return { ok: true, attempt }
}
