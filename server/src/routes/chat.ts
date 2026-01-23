import { Router } from 'express'
import { postChat } from '../controllers/chatController.js'

const router = Router()

router.post('/', postChat)

export default router
