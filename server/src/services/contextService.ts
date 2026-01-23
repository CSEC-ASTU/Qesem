import UserMemory from '../models/UserMemory.js'

// naive in-memory cache for repeated Q&A within process lifetime
const answerCache = new Map<string, any>()

export function cacheKey(question: string, contextHash: string) {
  return `${question}::${contextHash}`
}

export function getCachedAnswer(key: string) {
  return answerCache.get(key)
}

export function setCachedAnswer(key: string, value: any) {
  answerCache.set(key, value)
}

export async function summarizeAndStore(messages: any[], userId?: string) {
  if (!userId) return
  // Placeholder: in production call an LLM summarizer; here we keep the last human+ai texts
  const last = messages.slice(-4).map((m: any) => (m?.content ?? m?.text ?? '')).join(' \n ')
  await UserMemory.updateOne(
    { userId },
    { $push: { summaries: { content: last, ts: new Date() } } },
    { upsert: true }
  )
}

export async function getRelevantSummaries(userId?: string, limit = 5) {
  if (!userId) return []
  const mem = await UserMemory.findOne({ userId }).lean()
  const summaries = (mem as any)?.summaries || []
  if (!Array.isArray(summaries)) return []
  return summaries.slice(-limit)
}
