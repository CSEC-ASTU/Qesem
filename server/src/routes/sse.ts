import { Router } from 'express'
import { getSSE } from '../controllers/sseController.js'

const router = Router()

router.get('/', getSSE)

export default router
