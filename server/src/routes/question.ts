import { Router } from 'express'
import { vectorSearchChunks } from '../utils/rag.js'
import { formatSourcesForClient } from '../utils/sources.js'

const router = Router()

// Question route: returns sources along with a placeholder answer
router.post('/', async (req, res) => {
  const { question, query, answer } = req.body || {}
  const q = (question || query || '').toString()
  try {
    const retrieved = q ? await vectorSearchChunks(q, { topK: 5 }) : []
    const sources = formatSourcesForClient(retrieved)
    // In a future step, replace this placeholder with actual LLM-generated answer
    const finalAnswer = (answer as string) || 'Answer generated from your notes.'
    res.json({ ok: true, answer: finalAnswer, sources })
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Failed to process question' })
  }
})

export default router
