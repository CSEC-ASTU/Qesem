import { Router } from 'express'
import { appendSession, getSession, listSessions, postSession } from '../controllers/sessionController.js'

const router = Router()

router.post('/', postSession)
router.get('/', listSessions)
router.get('/:id', getSession)
router.post('/:id/resume', appendSession)

export default router
