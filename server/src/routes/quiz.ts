import { Router } from 'express'
import { postQuiz } from '../controllers/quizController.js'

const router = Router()

// Generate quiz questions handled by controller
router.post('/', postQuiz)

export default router
