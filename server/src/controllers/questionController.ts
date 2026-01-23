import { Request, Response } from 'express'
import { detectIntent } from '../utils/intent.js'
import { getExplainAnswer } from '../services/explainService.js'
import { retrieveChunks } from '../services/retrievalService.js'
import { formatSourcesForClient } from '../utils/sources.js'
import { buildQuizFromChunks } from '../services/quizService.js'

export async function postQuestion(req: Request, res: Response) {
  const { question, query, level, count } = (req.body || {}) as {
    question?: string
    query?: string
    level?: string
    count?: number
  }
  const q = (question || query || '').toString()
  const intent = detectIntent(req.body)

  try {
    if (intent === 'QUIZ') {
      const retrieved = q ? await retrieveChunks(q, 8) : []
      const sources = formatSourcesForClient(retrieved)
      const questions = buildQuizFromChunks(retrieved.map((c) => ({ content: c.content })), count || 5)
      return res.json({ ok: true, mode: 'quiz', questions, sources })
    }

    const explain = await getExplainAnswer(q, (level as any) || 'ELI5')
    return res.json({
      ok: true,
      mode: 'explain',
      answer: explain.answer,
      sources: explain.sources,
      guardFailed: explain.guardFailed
    })
  } catch (err) {
    console.error('postQuestion error:', err)
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ ok: false, error: message })
  }
}
