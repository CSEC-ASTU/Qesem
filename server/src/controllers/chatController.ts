import { Request, Response } from 'express'
import { detectIntent } from '../utils/intent.js'
import { retrieveChunks } from '../services/retrievalService.js'
import { buildQuizFromChunks } from '../services/quizService.js'
import { getExplainAnswer, streamExplainAnswer } from '../services/explainService.js'
import { initSse } from '../utils/sse.js'

export async function postChat(req: Request, res: Response) {
  const { question, query, level, stream, count } = (req.body || {}) as {
    question?: string
    query?: string
    level?: string
    stream?: boolean
    count?: number
  }
  const q = (question || query || '').toString()
  const intent = detectIntent(req.body)

  try {
    if (intent === 'QUIZ') {
      const retrieved = q ? await retrieveChunks(q, 8) : []
      const questions = buildQuizFromChunks(retrieved.map((c) => ({ content: c.content })), count || 5)
      return res.json({ ok: true, mode: 'quiz', questions, sources: retrieved })
    }

    if (stream) {
      const channel = initSse(res)
      channel.send('info', { message: 'Starting stream' })
      for await (const chunk of streamExplainAnswer(q, (level as any) || 'ELI5')) {
        if (chunk.type === 'AGENT_STEP') channel.send('info', { message: chunk.message })
        if (chunk.type === 'ANSWER_TOKEN') channel.send('token', chunk.token)
        if (chunk.type === 'SOURCES') channel.send('sources', chunk.sources)
      }
      channel.send('done', { ok: true })
      return channel.close()
    }

    const explain = await getExplainAnswer(q, (level as any) || 'ELI5')
    return res.json({
      ok: true,
      mode: 'explain',
      answer: explain.answer,
      sources: explain.sources,
      chunks: explain.retrieved,
      guardFailed: explain.guardFailed
    })
  } catch (err) {
    console.error('postChat error:', err)
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ ok: false, error: message })
  }
}
