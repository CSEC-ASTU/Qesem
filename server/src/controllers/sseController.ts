import { Request, Response } from 'express'
import { getSourcesForQuery } from '../services/retrievalService.js'

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

  const message = (req.query.message as string) || 'Analyzing your request'
  const answer = (req.query.answer as string) || 'This is a streamed answer.'
  const query = (req.query.query as string) || ''

  try {
    // 1) Agent step
    writeEvent(res, { type: 'AGENT_STEP', message })

    // 2) Stream tokens for the answer
    const tokens = answer.split(/\s+/).filter(Boolean)
    for (const t of tokens) {
      writeEvent(res, { type: 'ANSWER_TOKEN', token: t })
      await new Promise((r) => setTimeout(r, 30))
    }

    // 3) If query provided, include sources attribution
    if (query && query.trim()) {
      const sources = await getSourcesForQuery(query, 5)
      writeEvent(res, { type: 'SOURCES', sources })
    }

    // 4) Done
    writeEvent(res, { type: 'DONE' })
  } catch (_err) {
    writeEvent(res, { type: 'ERROR', error: 'Stream failed' })
  } finally {
    res.end()
  }
}
