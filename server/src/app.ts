import express from 'express'
import cors from 'cors'

import uploadRouter from './routes/upload.js'
import questionRouter from './routes/question.js'
import quizRouter from './routes/quiz.js'
import mongoose from 'mongoose'

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/qesem'

mongoose.connect(MONGO_URI).catch((err) => {
	console.error('Mongo connection error', err)
})

const app = express()

// Enable CORS and JSON body parsing
app.use(cors())
app.use(express.json())

// Mount routes
app.use('/upload', uploadRouter)
app.use('/question', questionRouter)
app.use('/quiz', quizRouter)

export default app
