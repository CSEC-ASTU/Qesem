import { Request, Response } from 'express'
import { getSourcesForQuery } from '../services/retrievalService.js'

export async function postQuestion(req: Request, res: Response) {
  const { question, query, answer } = (req.body || {}) as { question?: string; query?: string; answer?: string }
  const q = (question || query || '').toString()
  try {
    const sources = q ? await getSourcesForQuery(q, 5) : []
    const finalAnswer = answer || 'Answer generated from your notes.'
    res.json({ ok: true, answer: finalAnswer, sources })
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Failed to process question' })
  }
}
