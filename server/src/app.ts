import express from 'express'
import cors from 'cors'

import uploadRouter from './routes/upload.js'
import sseRouter from './routes/sse.js'
import chatRouter from './routes/chat.js'
import quizAutoRouter from './routes/quizAuto.js'
import sessionsRouter from './routes/sessions.js'
import mongoose from 'mongoose'
import dotenv from 'dotenv'

dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI

if (!MONGODB_URI) {
	throw new Error('MONGODB_URI environment variable is not set')
}

// Track whether Mongo is reachable; useful for degraded-mode decisions
export let isMongoConnected = false

// Connect with resilient options and allow degraded startup on failure
export const mongoReady = mongoose
	.connect(MONGODB_URI, {
		serverSelectionTimeoutMS: 8000,
		socketTimeoutMS: 20000,
		maxPoolSize: 10,
		retryWrites: true,
		family: 4,
	})
	.then(() => {
		isMongoConnected = true
		console.log('MongoDB connected')
	})
	.catch((err) => {
		isMongoConnected = false
		console.error('Mongo connection error', err)
		// Do not throw here; allow server to start in degraded mode
	})

mongoose.connection.on('connected', () => {
	isMongoConnected = true
	console.log('MongoDB connection established')
})

mongoose.connection.on('disconnected', () => {
	isMongoConnected = false
	console.warn('MongoDB disconnected — running in degraded mode')
})

mongoose.connection.on('error', (err) => {
	isMongoConnected = false
	console.error('MongoDB error:', err?.message || err)
})

const app = express()

// Enable permissive CORS and JSON body parsing
const corsOptions = {
	origin: '*',
	methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
	allowedHeaders: ['Content-Type', 'Authorization'],
	credentials: false,
}

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))
app.use(express.json())

// Mount routes
app.use('/upload', uploadRouter)
app.use('/quiz', quizAutoRouter)
app.use('/sse', sseRouter)
app.use('/chat', chatRouter)
app.use('/sessions', sessionsRouter)

export default app
