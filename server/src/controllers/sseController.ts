import { Request, Response } from 'express'
import { detectIntent } from '../utils/intent.js'
import { streamExplainAnswer } from '../services/explainService.js'
import { retrieveChunks } from '../services/retrievalService.js'
import { formatSourcesForClient } from '../utils/sources.js'
import { buildQuizFromChunks } from '../services/quizService.js'

function writeEvent(res: Response, payload: unknown) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

export async function getSSE(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  // Prevent request from timing out during streaming
  req.socket.setTimeout(0)

  const query = (req.query.query as string) || ''
  const level = (req.query.level as string) || 'ELI5'
  const mode = (req.query.mode as string) || 'explain'
  const desiredQuizCount = Number(req.query.count) || 5

  try {
    const intent = detectIntent({ mode })

    if (intent === 'QUIZ') {
      const retrieved = query ? await retrieveChunks(query, 8) : []
      const sources = formatSourcesForClient(retrieved)
      const questions = buildQuizFromChunks(retrieved.map((c) => ({ content: c.content })), desiredQuizCount)
      writeEvent(res, { type: 'AGENT_STEP', message: 'Generating quiz from your notes...' })
      writeEvent(res, { type: 'QUIZ', questions })
      writeEvent(res, { type: 'SOURCES', sources })
      writeEvent(res, { type: 'DONE' })
      return
    }

    // EXPLAIN FLOW
    for await (const event of streamExplainAnswer(query, level as any)) {
      writeEvent(res, event)
    }
    writeEvent(res, { type: 'DONE' })
  } catch (_err) {
    writeEvent(res, { type: 'ERROR', error: 'Stream failed' })
  } finally {
    res.end()
  }
}
