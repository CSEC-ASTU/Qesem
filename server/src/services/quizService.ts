import { generateQuizQuestions } from '../utils/quiz.js'

export function buildQuizFromChunks(chunks: Array<{ content: string }>, count = 5) {
  return generateQuizQuestions(chunks, count)
}
