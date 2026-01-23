import { generateQuizQuestions, getAnswer } from '../utils/quiz.js'
import { evaluateAnswer } from '../utils/evaluate.js'

export function buildQuizFromChunks(chunks: Array<{ content: string }>, count = 5) {
  return generateQuizQuestions(chunks, count)
}

export async function gradeQuizAnswer(questionId: string, studentAnswer: string) {
  const record = getAnswer(questionId)
  if (!record) {
    throw new Error('Unknown question id')
  }
  return evaluateAnswer(studentAnswer, record.answer)
}
