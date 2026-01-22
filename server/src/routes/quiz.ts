import { Router } from 'express'
import { generateQuizQuestions } from '../utils/quiz.js'

const router = Router()

// Generate quiz questions from provided chunks
router.post('/', async (req, res) => {
  try {
    const chunks = Array.isArray(req.body?.chunks) ? req.body.chunks : []
    const desiredCount = typeof req.body?.count === 'number' ? req.body.count : 5

    if (!chunks.length) {
      return res.status(400).json({ error: 'No chunks provided' })
    }

    const questions = generateQuizQuestions(chunks, desiredCount)
    return res.json({ questions })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to generate quiz' })
  }
})

export default router
