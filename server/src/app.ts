import express from 'express'
import cors from 'cors'

import uploadRouter from './routes/upload.js'
import questionRouter from './routes/question.js'
import quizRouter from './routes/quiz.js'
import sseRouter from './routes/sse.js'
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
app.use('/sse', sseRouter)

export default app
