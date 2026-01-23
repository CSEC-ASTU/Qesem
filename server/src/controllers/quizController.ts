import { Request, Response } from 'express'
import { buildQuizFromChunks, gradeQuizAnswer } from '../services/quizService.js'

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

export async function postQuizEvaluate(req: Request, res: Response) {
  try {
    const questionId = typeof req.body?.questionId === 'string' ? req.body.questionId : ''
    const studentAnswer = typeof req.body?.answer === 'string' ? req.body.answer : ''

    if (!questionId || !studentAnswer) {
      return res.status(400).json({ error: 'questionId and answer are required' })
    }

    const evaluation = await gradeQuizAnswer(questionId, studentAnswer)
    return res.json({ evaluation })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to evaluate answer' })
  }
}
