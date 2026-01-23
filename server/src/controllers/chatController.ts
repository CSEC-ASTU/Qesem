import { Request, Response } from 'express'
import { runLearningGraph, type LearningGraphState } from '../agents/learningGraph.js'

export async function postChat(req: Request, res: Response) {
  try {
    const result: LearningGraphState = await runLearningGraph(req.body || {})
    return res.json({ ok: true, result: result.toolResult, retrieved: result.retrievedChunks, mode: result.mode })
  } catch (err) {
    console.error('postChat error:', err)
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ ok: false, error: message })
  }
}
