import { Router } from 'express'
import { postQuestion } from '../controllers/questionController.js'

const router = Router()

// Question route handled by controller
router.post('/', postQuestion)

export default router
