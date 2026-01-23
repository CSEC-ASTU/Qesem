import { Request, Response } from 'express'
import { runLearningGraph, type LearningGraphState } from '../agents/learningGraph.js'
import { initSse } from '../utils/sse.js'

export async function postChat(req: Request, res: Response) {
  try {
    const stream = req.query.stream === 'true'
    if (stream) {
      const { writeEvent, close } = initSse(res)
      const result: LearningGraphState = await runLearningGraph(req.body || {}, { sse: writeEvent })
      writeEvent({ type: 'DONE', result: result.toolResult, retrieved: result.retrievedChunks, mode: result.mode })
      close()
      return
    }

    const result: LearningGraphState = await runLearningGraph(req.body || {})
    return res.json({ ok: true, result: result.toolResult, retrieved: result.retrievedChunks, mode: result.mode })
  } catch (err) {
    console.error('postChat error:', err)
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ ok: false, error: message })
  }
}
