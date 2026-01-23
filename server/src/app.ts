import express from 'express'
import cors from 'cors'

import uploadRouter from './routes/upload.js'
import questionRouter from './routes/question.js'
import quizRouter from './routes/quiz.js'
import sseRouter from './routes/sse.js'
import chatRouter from './routes/chat.js'
import quizAutoRouter from './routes/quizAuto.js'
import sessionsRouter from './routes/sessions.js'
import mongoose from 'mongoose'
import 'dotenv/config'

const MONGODB_URI = process.env.MONGODB_URI

if (!MONGODB_URI) {
	throw new Error('MONGODB_URI environment variable is not set')
}

export const mongoReady = mongoose.connect(MONGODB_URI).then(() => {
	console.log(`MongoDB connected`)
}).catch((err) => {
	console.error('Mongo connection error', err)
	throw err
})

const app = express()

// Enable CORS and JSON body parsing
app.use(cors())
app.use(express.json())

// Mount routes
app.use('/upload', uploadRouter)
app.use('/question', questionRouter)
app.use('/quiz', quizRouter)
app.use('/quiz', quizAutoRouter)
app.use('/sse', sseRouter)
app.use('/chat', chatRouter)
app.use('/sessions', sessionsRouter)

export default app
