import express from 'express'
import cors from 'cors'

import uploadRouter from './routes/upload.js'
import questionRouter from './routes/question.js'
import quizRouter from './routes/quiz.js'

const app = express()

// Enable CORS and JSON body parsing
app.use(cors())
app.use(express.json())

// Mount routes
app.use('/upload', uploadRouter)
app.use('/question', questionRouter)
app.use('/quiz', quizRouter)

export default app
