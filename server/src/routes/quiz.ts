import { Router } from 'express'

const router = Router()

// Placeholder quiz route
router.get('/', async (_req, res) => {
  res.json({ ok: true, route: 'quiz' })
})

export default router
