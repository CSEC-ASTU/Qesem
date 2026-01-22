import { Router } from 'express'
import { postQuiz, postQuizEvaluate } from '../controllers/quizController.js'

const router = Router()

// Generate quiz questions handled by controller
router.post('/', postQuiz)
router.post('/evaluate', postQuizEvaluate)

export default router
