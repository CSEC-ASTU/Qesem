import { Schema, model, Types } from 'mongoose'

export interface QuizQuestionDoc {
  questionId: string
  prompt: string
  type: string
  options?: string[]
  answer: string
  studentAnswer?: string
  result?: string
  feedback?: string
  similarity?: number
  overlap?: number
}

export interface QuizAttemptAttrs {
  topic: string
  difficulty?: string
  questionCount: number
  questionType?: string
  questions: QuizQuestionDoc[]
  score?: number
  weakAreas?: string[]
}

const questionSchema = new Schema<QuizQuestionDoc>(
  {
    questionId: { type: String, required: true },
    prompt: { type: String, required: true },
    type: { type: String, required: true },
    options: { type: [String], default: [] },
    answer: { type: String, required: true },
    studentAnswer: String,
    result: String,
    feedback: String,
    similarity: Number,
    overlap: Number
  },
  { _id: false }
)

const quizAttemptSchema = new Schema<QuizAttemptAttrs>(
  {
    topic: { type: String, required: true, index: true },
    difficulty: { type: String },
    questionCount: { type: Number, default: 5 },
    questionType: { type: String },
    questions: { type: [questionSchema], default: [] },
    score: Number,
    weakAreas: { type: [String], default: [] }
  },
  { timestamps: true }
)

const QuizAttempt = model<QuizAttemptAttrs>('QuizAttempt', quizAttemptSchema)
export default QuizAttempt
