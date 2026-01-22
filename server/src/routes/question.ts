import { Router } from 'express'

const router = Router()

// Placeholder question route
router.post('/', async (req, res) => {
  res.json({ ok: true, route: 'question' })
})

export default router
