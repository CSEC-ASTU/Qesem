export type QuestionType = 'short' | 'mcq'

export interface ChunkInput {
  content: string
  documentName?: string
  pageNumber?: number
  chunkIndex?: number
}

export interface Question {
  id: string
  type: QuestionType
  prompt: string
  options?: string[]
}

interface AnswerRecord {
  type: QuestionType
  answer: string
}

const answersStore = new Map<string, AnswerRecord>()

function sentenceSplit(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20) // keep meaningful sentences
}

function pickKeyTerm(words: string[]): string | null {
  const candidates = words
    .filter((w) => /[A-Za-z]/.test(w))
    .map((w) => w.replace(/[^A-Za-z0-9'-]/g, ''))
    .filter((w) => w.length >= 6)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.length - a.length)
  return candidates[0]
}

function uniqueId(prefix = 'q'): string {
  const r = Math.floor(Math.random() * 1e6)
  return `${prefix}-${Date.now()}-${r}`
}

function createShortQuestion(sentence: string): Question | null {
  const words = sentence.split(/\s+/)
  const key = pickKeyTerm(words)
  if (!key) return null
  const blanked = words
    .map((w) => (w.replace(/[^A-Za-z0-9'-]/g, '') === key ? '_____' : w))
    .join(' ')
  const id = uniqueId('short')
  answersStore.set(id, { type: 'short', answer: key })
  return {
    id,
    type: 'short',
    prompt: `Fill in the blank based on the notes: ${blanked}`
  }
}

function createMcqQuestion(sentence: string, pool: string[]): Question | null {
  const words = sentence.split(/\s+/)
  const key = pickKeyTerm(words)
  if (!key) return null
  const distractors = pool
    .map((w) => w.replace(/[^A-Za-z0-9'-]/g, ''))
    .filter((w) => w.length >= 5 && w.toLowerCase() !== key.toLowerCase())
    .filter((w, i, arr) => arr.indexOf(w) === i)
    .slice(0, 6)

  // ensure we have at least 3 options
  const optionsSet = new Set<string>([key])
  for (const d of distractors) {
    optionsSet.add(d)
    if (optionsSet.size >= 4) break
  }
  // fallback distractors
  const fallback = ['Concept', 'Method', 'Theory', 'Practice']
  for (const f of fallback) {
    if (optionsSet.size >= 4) break
    optionsSet.add(f)
  }

  const options = Array.from(optionsSet)
  // shuffle options
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[options[i], options[j]] = [options[j], options[i]]
  }

  const id = uniqueId('mcq')
  answersStore.set(id, { type: 'mcq', answer: key })
  return {
    id,
    type: 'mcq',
    prompt: `Choose the best term that fits this statement from the notes: ${sentence}`,
    options
  }
}

export function generateQuizQuestions(chunks: ChunkInput[], desiredCount = 5): Question[] {
  const sentences: string[] = []
  for (const c of chunks) {
    sentences.push(...sentenceSplit(c.content || ''))
  }
  const poolWords = sentences.flatMap((s) => s.split(/\s+/))

  const count = Math.max(3, Math.min(5, desiredCount))
  const questions: Question[] = []

  // alternate short and mcq where possible
  let si = 0
  while (questions.length < count && si < sentences.length) {
    const s = sentences[si]
    // try short
    const shortQ = createShortQuestion(s)
    if (shortQ) questions.push(shortQ)
    if (questions.length >= count) break
    // try mcq
    const mcqQ = createMcqQuestion(s, poolWords)
    if (mcqQ) questions.push(mcqQ)
    si += 1
  }

  // ensure we only return questions (no answers)
  return questions.slice(0, count)
}

export function getAnswer(questionId: string): AnswerRecord | undefined {
  return answersStore.get(questionId)
}

export function clearAnswers() {
  answersStore.clear()
}

export function storeAnswer(questionId: string, type: QuestionType, answer: string) {
  answersStore.set(questionId, { type, answer })
}

export { uniqueId }
