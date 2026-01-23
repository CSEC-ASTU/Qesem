import { ExplainLevel, buildPrompt } from '../utils/prompt.js'
import { guardRetrievedChunks, RetrievedChunk } from '../utils/rag.js'
import { getSourcesForQuery, retrieveChunks } from './retrievalService.js'
import { completeChat, streamChatCompletion } from './llmService.js'
import { formatSourcesForClient, SourceItem } from '../utils/sources.js'

interface ExplainPrep {
  prompt?: string
  sources: SourceItem[]
  guardFailed?: boolean
  guardMessage?: string
  retrieved: RetrievedChunk[]
}

async function prepareExplain(question: string, level: ExplainLevel): Promise<ExplainPrep> {
  const retrieved = await retrieveChunks(question, 5)
  const guard = guardRetrievedChunks(retrieved)
  if (!guard.allowed) {
    return {
      guardFailed: true,
      guardMessage: guard.message || "I can’t find this in your notes.",
      sources: [],
      retrieved
    }
  }
  const prompt = buildPrompt(level, question, retrieved)
  const sources = formatSourcesForClient(retrieved)
  return { prompt, sources, retrieved }
}

export async function getExplainAnswer(question: string, level: ExplainLevel) {
  const prep = await prepareExplain(question, level)
  if (prep.guardFailed || !prep.prompt) {
    return {
      answer: prep.guardMessage || "I can’t find this in your notes.",
      sources: prep.sources,
      retrieved: prep.retrieved,
      guardFailed: true
    }
  }

  const answer = await completeChat(prep.prompt)
  return { answer, sources: prep.sources, retrieved: prep.retrieved, guardFailed: false }
}

export async function* streamExplainAnswer(question: string, level: ExplainLevel) {
  const prep = await prepareExplain(question, level)
  if (prep.guardFailed || !prep.prompt) {
    yield { type: 'AGENT_STEP', message: prep.guardMessage || "I can’t find this in your notes." }
    yield { type: 'SOURCES', sources: prep.sources }
    return
  }

  yield { type: 'AGENT_STEP', message: 'Searching notes...' }
  const stream = streamChatCompletion(prep.prompt)
  for await (const token of stream) {
    yield { type: 'ANSWER_TOKEN', token }
  }
  yield { type: 'SOURCES', sources: prep.sources }
}

