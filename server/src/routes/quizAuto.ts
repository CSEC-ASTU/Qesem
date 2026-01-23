import { Router } from 'express'
import { postQuizAuto, postQuizAutoEvaluate } from '../controllers/quizFlowController.js'

const router = Router()

router.post('/auto', postQuizAuto)
router.post('/auto/evaluate', postQuizAutoEvaluate)

export default router
