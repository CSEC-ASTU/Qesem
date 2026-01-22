import { embedText } from './embedText.js'

export type EvalLabel = 'Correct' | 'Partially Correct' | 'Incorrect'

export interface EvaluationResult {
  result: EvalLabel
  explanation: string
  scores: {
    exact: boolean
    overlap: number
    similarity?: number
  }
}

function normalize(s: string): string {
  return s.trim().toLowerCase()
}

const STOP = new Set([
  'the','a','an','and','or','of','in','on','at','to','for','from','by','with','is','are','was','were','be','been','being','as','that','this','these','those','it','its','into','about','over','under','than','then','so','such','very'
])

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
}

function overlapScore(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let inter = 0
  for (const t of setA) if (setB.has(t)) inter += 1
  const denom = Math.min(setA.size, setB.size)
  return denom === 0 ? 0 : inter / denom
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export async function evaluateAnswer(
  student: string,
  correct: string
): Promise<EvaluationResult> {
  const sNorm = normalize(student)
  const cNorm = normalize(correct)

  if (!sNorm) {
    return {
      result: 'Incorrect',
      explanation: 'Your answer is empty.',
      scores: { exact: false, overlap: 0 }
    }
  }

  if (sNorm === cNorm) {
    return {
      result: 'Correct',
      explanation: 'Exact match with the expected answer.',
      scores: { exact: true, overlap: 1 }
    }
  }

  const sTok = tokenize(student)
  const cTok = tokenize(correct)
  const overlap = overlapScore(sTok, cTok)

  if (overlap >= 0.6) {
    return {
      result: 'Correct',
      explanation: 'Your answer closely matches key terms in the expected answer.',
      scores: { exact: false, overlap }
    }
  }
  if (overlap >= 0.3) {
    return {
      result: 'Partially Correct',
      explanation: 'Your answer covers some of the key terms, but misses important details.',
      scores: { exact: false, overlap }
    }
  }

  try {
    const [sEmb, cEmb] = await Promise.all([embedText(student), embedText(correct)])
    const sim = cosineSimilarity(sEmb, cEmb)
    if (sim >= 0.85) {
      return {
        result: 'Correct',
        explanation: 'Your answer is semantically very close to the expected answer.',
        scores: { exact: false, overlap, similarity: sim }
      }
    }
    if (sim >= 0.7) {
      return {
        result: 'Partially Correct',
        explanation: 'Your answer is semantically related, but not precise enough.',
        scores: { exact: false, overlap, similarity: sim }
      }
    }
    return {
      result: 'Incorrect',
      explanation: 'Your answer does not match the expected answer.',
      scores: { exact: false, overlap, similarity: sim }
    }
  } catch {
    return {
      result: 'Incorrect',
      explanation: 'Your answer does not sufficiently match the expected answer.',
      scores: { exact: false, overlap }
    }
  }
}
