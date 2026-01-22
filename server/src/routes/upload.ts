import { Router } from 'express'

const router = Router()

// Placeholder upload route
router.post('/', async (req, res) => {
  // TODO: implement file handling
  res.json({ ok: true, route: 'upload' })
})

export default router
