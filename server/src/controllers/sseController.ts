import { Request, Response } from 'express'
import { initSse } from '../utils/sse.js'
import { retrieveChunks } from '../services/retrievalService.js'
import { buildQuizFromChunks } from '../services/quizService.js'
import { streamExplainAnswer } from '../services/explainService.js'

export async function getSSE(req: Request, res: Response) {
  const { writeEvent, close } = initSse(res)
  const query = (req.query.query as string) || ''
  const level = (req.query.level as string) || 'ELI5'
  const mode = (req.query.mode as string) || 'explain'
  const desiredQuizCount = Number(req.query.count) || 5

  try {
    if (mode === 'quiz') {
      const retrieved = query ? await retrieveChunks(query, 8) : []
      writeEvent({ type: 'AGENT_STEP', message: 'Generating quiz from your notes...' })
      if (!retrieved.length) {
        writeEvent({ type: 'DONE', error: 'No sufficient context to generate quiz.' })
        return
      }
      const questions = await buildQuizFromChunks(
        retrieved.map((c) => ({ content: c.content })),
        desiredQuizCount
      )
      writeEvent({ type: 'QUIZ', questions })
      writeEvent({ type: 'DONE' })
      return
    }

    writeEvent({ type: 'AGENT_STEP', message: 'Retrieving context...' })
    for await (const event of streamExplainAnswer(query, level as any)) {
      writeEvent(event as any)
    }
    writeEvent({ type: 'DONE' })
  } catch (_err) {
    writeEvent({ type: 'ERROR', error: 'Stream failed' })
  } finally {
    close()
  }
}
