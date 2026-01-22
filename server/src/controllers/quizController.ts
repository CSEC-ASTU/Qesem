import { Request, Response } from 'express'
import { buildQuizFromChunks } from '../services/quizService.js'

export async function postQuiz(req: Request, res: Response) {
  try {
    const chunks = Array.isArray(req.body?.chunks) ? req.body.chunks : []
    const desiredCount = typeof req.body?.count === 'number' ? req.body.count : 5

    if (!chunks.length) {
      return res.status(400).json({ error: 'No chunks provided' })
    }

    const questions = buildQuizFromChunks(chunks, desiredCount)
    return res.json({ questions })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to generate quiz' })
  }
}
