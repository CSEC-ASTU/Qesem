import { completeChat } from './llmService.js'
import {
  clearAnswers,
  generateQuizQuestions,
  getAnswer,
  storeAnswer,
  type Question,
  type QuestionType,
  type ChunkInput,
  uniqueId
} from '../utils/quiz.js'
import { evaluateAnswer } from '../utils/evaluate.js'

function buildPrompt(notes: ChunkInput[], count: number): string {
  const safeCount = Math.max(3, Math.min(8, count || 5))
  const joinedNotes = notes
    .map((c) => (c.content || '').trim())
    .filter(Boolean)
    .join('\n\n---\n\n') || '(no notes)'

  const basePrompt = [
    'You are an expert instructor creating exam-quality questions.',
    '',
    'You are given study notes extracted from a course.',
    'Your task is to generate meaningful quiz questions that test understanding,',
    'NOT memorization or keyword recall.',
    '',
    'STRICT RULES:',
    '- Do NOT copy sentences directly from the notes.',
    '- Do NOT create fill-in-the-blank questions based on single words.',
    '- Avoid repeated concepts.',
    '- Each question must test comprehension, reasoning, or application.',
    '- Questions must be answerable ONLY using the provided notes.',
    '- Difficulty: undergraduate exam level.',
    '- No trick questions.',
    '- One clearly correct answer.',
    '',
    'Question types allowed:',
    '- Conceptual multiple-choice (why/how)',
    '- Scenario-based questions',
    '- Short-answer explanation questions',
    '',
    'For MCQs:',
    '- 4 options',
    '- 1 correct answer',
    '- Wrong options must be plausible but incorrect',
    '',
    'For short-answer:',
    '- Provide a clear expected answer (1–2 sentences)',
    '',
    'OUTPUT FORMAT (JSON ONLY):',
    '',
    '{',
    '  "questions": [',
    '    {',
    '      "id": "q1",',
    '      "type": "mcq",',
    '      "prompt": "...",',
    '      "options": ["A", "B", "C", "D"],',
    '      "answer": "B"',
    '    },',
    '    {',
    '      "id": "q2",',
    '      "type": "short",',
    '      "prompt": "...",',
    '      "answer": "Expected answer here"',
    '    }',
    '  ]',
    '}',
    '',
    `Generate exactly ${safeCount} questions. Respond with JSON only.`,
    '',
    'STUDY NOTES:',
    joinedNotes
  ]

  return basePrompt.join('\n')
}

function normalizeQuestion(q: any): Question | null {
  if (!q || typeof q !== 'object') return null
  const prompt = typeof q.prompt === 'string' ? q.prompt.trim() : ''
  const type: QuestionType = q.type === 'mcq' ? 'mcq' : 'short'
  if (!prompt) return null
  const id = typeof q.id === 'string' && q.id.trim() ? q.id.trim() : uniqueId('q')
  const answer = typeof q.answer === 'string' ? q.answer.trim() : ''

  if (type === 'mcq') {
    const opts = Array.isArray(q.options) ? q.options.map((o: any) => String(o || '').trim()).filter(Boolean) : []
    if (opts.length < 4) return null
    storeAnswer(id, type, answer || opts[0])
    return { id, type, prompt, options: opts.slice(0, 4) }
  }

  storeAnswer(id, type, answer)
  return { id, type, prompt }
}

async function generateWithPrompt(chunks: ChunkInput[], count: number): Promise<Question[] | null> {
  const prompt = buildPrompt(chunks, count)
  try {
    const raw = await completeChat(prompt)
    const parsed = JSON.parse(raw || '{}')
    const rawQs = Array.isArray(parsed?.questions) ? parsed.questions : []
    const normalized = rawQs.map((q: any) => normalizeQuestion(q)).filter(Boolean) as Question[]
    return normalized.slice(0, Math.max(1, count))
  } catch (err) {
    console.error('Quiz generation via LLM failed, falling back to heuristic:', err)
    return null
  }
}

export async function buildQuizFromChunks(chunks: ChunkInput[], count = 5): Promise<Question[]> {
  clearAnswers()
  const llmQuestions = await generateWithPrompt(chunks, count)
  if (llmQuestions && llmQuestions.length) return llmQuestions
  return generateQuizQuestions(chunks, count)
}

export async function gradeQuizAnswer(questionId: string, studentAnswer: string) {
  const record = getAnswer(questionId)
  if (!record) {
    throw new Error('Unknown question id')
  }
  return evaluateAnswer(studentAnswer, record.answer)
}
