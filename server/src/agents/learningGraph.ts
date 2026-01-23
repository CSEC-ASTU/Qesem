import { z } from 'zod'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { tool } from '@langchain/core/tools'
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  ReducedValue,
  START,
  END,
  type GraphNode
} from '@langchain/langgraph'
import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages'

import { getExplainAnswer } from '../services/explainService.js'
import { retrieveChunks } from '../services/retrievalService.js'
import { buildQuizFromChunks } from '../services/quizService.js'
import { getAnswer } from '../utils/quiz.js'
import { evaluateAnswer } from '../utils/evaluate.js'
import QuizAttempt from '../models/QuizAttempt.js'
import { ensureChunks, ensureAttempt } from '../services/guardService.js'
import { getCachedAnswer, setCachedAnswer, cacheKey, getRelevantSummaries } from '../services/contextService.js'

const MessagesState = new StateSchema({
  messages: MessagesValue,
  llmCalls: new ReducedValue(z.number().default(0), { reducer: (x, y) => x + y }),
  mode: new ReducedValue(z.string().optional(), { reducer: (_x, y) => y ?? _x }),
  toolResult: new ReducedValue(z.any(), { reducer: (_x, y) => y }),
  retrievedChunks: new ReducedValue(z.array(z.any()).optional(), { reducer: (_x, y) => y }),
  selectedAction: new ReducedValue(z.string().optional(), { reducer: (_x, y) => y ?? _x }),
  toolArgs: new ReducedValue(z.any(), { reducer: (_x, y) => y ?? _x }),
  guardStop: new ReducedValue(z.boolean().optional(), { reducer: (_x, y) => y ?? _x }),
  userId: new ReducedValue(z.string().optional(), { reducer: (_x, y) => y ?? _x })
})

const explainTool = tool(
  async ({ question, level }: { question: string; level?: string }) => {
    const result = await getExplainAnswer(question, (level as any) || 'ELI5')
    return result
  },
  {
    name: 'explainTool',
    description: 'Answer a question using RAG. Inputs: question (string), optional level (ELI5|ELI15|EXAM).',
    schema: z.object({
      question: z.string().describe('User question to answer using context'),
      level: z.string().optional()
    })
  }
)

const quizGenerationTool = tool(
  async ({ topic, questionCount }: { topic: string; questionCount?: number }) => {
    const retrieved = await retrieveChunks(topic, 10)
    if (!retrieved.length) {
      return { ok: false, error: 'No context found for topic' }
    }
    const questions = buildQuizFromChunks(retrieved.map((c) => ({ content: c.content })), questionCount || 5)
    const storedQuestions = questions.map((q) => {
      const ans = getAnswer(q.id)
      return {
        questionId: q.id,
        prompt: q.prompt,
        type: q.type,
        options: q.options || [],
        answer: ans?.answer || ''
      }
    })
    const attempt = await QuizAttempt.create({
      topic,
      questionCount: questionCount || questions.length,
      questions: storedQuestions
    })
    const responseQuestions = storedQuestions.map((q) => ({
      questionId: q.questionId,
      prompt: q.prompt,
      type: q.type,
      options: q.options
    }))
    return { ok: true, attemptId: attempt._id, questions: responseQuestions, retrieved }
  },
  {
    name: 'quizGenerationTool',
    description: 'Generate quiz questions for a topic using retrieved context and store answers.',
    schema: z.object({
      topic: z.string().describe('Topic to generate quiz for'),
      questionCount: z.number().optional()
    })
  }
)

const quizEvaluationTool = tool(
  async ({ attemptId, responses }: { attemptId: string; responses: Array<{ questionId: string; answer: string }> }) => {
    const attempt = await QuizAttempt.findById(attemptId)
    if (!attempt) return { ok: false, error: 'Attempt not found' }

    let correct = 0
    const weakAreas: string[] = []
    const feedback: Array<{ questionId: string; result: string; explanation: string }> = []

    for (const resp of responses) {
      const qid = resp?.questionId
      const answer = typeof resp?.answer === 'string' ? resp.answer : ''
      const q = attempt.questions.find((x) => x.questionId === qid)
      if (!q) continue
      const evalResult = await evaluateAnswer(answer, q.answer)
      q.studentAnswer = answer
      q.result = evalResult.result
      q.feedback = evalResult.explanation
      q.similarity = evalResult.scores.similarity
      q.overlap = evalResult.scores.overlap
      if (evalResult.result === 'Correct') correct += 1
      if (evalResult.result !== 'Correct') weakAreas.push(q.prompt)
      feedback.push({ questionId: qid, result: evalResult.result, explanation: evalResult.explanation })
    }

    attempt.score = attempt.questions.length ? (correct / attempt.questions.length) * 100 : 0
    attempt.weakAreas = weakAreas
    await attempt.save()

    return {
      ok: true,
      score: attempt.score,
      weakAreas,
      feedback,
      questions: attempt.questions.map((q) => ({ questionId: q.questionId, result: q.result, feedback: q.feedback }))
    }
  },
  {
    name: 'quizEvaluationTool',
    description: 'Evaluate student answers for a quiz attempt.',
    schema: z.object({
      attemptId: z.string().describe('Quiz attempt id to evaluate'),
      responses: z
        .array(
          z.object({
            questionId: z.string(),
            answer: z.string()
          })
        )
        .describe('List of answers to grade')
    })
  }
)

const tools = [explainTool, quizGenerationTool, quizEvaluationTool]
const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]))

const model = new ChatGoogleGenerativeAI({
  model: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
  apiKey: process.env.GOOGLE_API_KEY,
  temperature: 0.2,
  maxRetries: 0
})
const modelWithTools = model.bindTools(tools)

const llmCall: GraphNode<typeof MessagesState> = async (state) => {
  const baseMessages = state.messages.length ? state.messages : []
  try {
    const response = await modelWithTools.invoke([
      new SystemMessage('You are a helpful assistant that chooses the right educational tool.'),
      ...baseMessages
    ])
    const call = response.tool_calls?.[0]
    return {
      messages: [response],
      llmCalls: 1,
      mode: 'llm',
      selectedAction: call?.name,
      toolArgs: call?.args
    }
  } catch (err: any) {
    const msg = String(err?.message || '')
    const isQuota = err?.status === 429 || /quota|rate limit/i.test(msg)
    if (isQuota) {
      return { messages: [], llmCalls: 0, mode: 'fallback' }
    }
    throw err
  }
}

const toolNode: GraphNode<typeof MessagesState> = async (state) => {
  const action = state.selectedAction
  const args = state.toolArgs || {}
  const toolMsgs: ToolMessage[] = []
  let lastRaw: any = undefined
  let lastRetrieved: any[] | undefined = undefined
  if (!action) {
    return { messages: [], mode: state.mode ?? 'fallback' }
  }
  const t = toolsByName[action]
  if (!t) {
    return { messages: [], mode: 'fallback', toolResult: { ok: false, error: `Unknown tool ${action}` } }
  }
  const raw = await (t as any).invoke(args)
  lastRaw = raw
  lastRetrieved = (raw as any)?.retrieved || state.retrievedChunks || undefined
  toolMsgs.push(
    new ToolMessage({
      tool_call_id: action,
      name: action,
      content: typeof raw === 'string' ? raw : JSON.stringify(raw)
    })
  )
  return { messages: toolMsgs, toolResult: lastRaw, retrievedChunks: lastRetrieved }
}

function chooseToolByShape(input: any): { name: string; args: Record<string, any> } | null {
  if (typeof input === 'string' && input.trim()) {
    return { name: 'explainTool', args: { question: input, level: 'ELI5' } }
  }
  if (input && typeof input === 'object') {
    if (typeof input.question === 'string') {
      return { name: 'explainTool', args: { question: input.question, level: input.level || 'ELI5' } }
    }
    if (typeof input.topic === 'string') {
      return { name: 'quizGenerationTool', args: { topic: input.topic, questionCount: input.questionCount } }
    }
    if (typeof input.attemptId === 'string' && Array.isArray(input.responses)) {
      return { name: 'quizEvaluationTool', args: { attemptId: input.attemptId, responses: input.responses } }
    }
  }
  return null
}

const guardNode: GraphNode<typeof MessagesState> = async (state) => {
  // If toolResult already set (guard failure), stop.
  if (state.guardStop) return state

  // Fallback tool choice if LLM didn't select
  if (!state.selectedAction) {
    const first = state.messages.find((m: any) => HumanMessage.isInstance(m))
    const content: any = (first as any)?.text ?? (first as any)?.content
    let parsed: any = content
    try {
      if (typeof content === 'string') parsed = JSON.parse(content)
    } catch (_) {
      parsed = content
    }
    const fb = chooseToolByShape(parsed)
    if (fb) {
      state.selectedAction = fb.name
      state.toolArgs = fb.args
      state.mode = state.mode ?? 'fallback'
    }
  }

  // Cache check for explain
  if (state.selectedAction === 'explainTool') {
    const question = (state.toolArgs as any)?.question || ''
    const cacheK = cacheKey(question, 'default')
    const cached = getCachedAnswer(cacheK)
    if (cached) {
      return { ...state, toolResult: cached, guardStop: true, mode: 'cache' }
    }
  }

  // Retrieval guard for explain/quizGeneration
  if (state.selectedAction === 'explainTool') {
    const question = (state.toolArgs as any)?.question || ''
    const retrieved = await retrieveChunks(question, 10)
    const guard = ensureChunks(retrieved, "I can't find this in your notes.")
    if (guard) return { ...state, toolResult: guard, guardStop: true, mode: 'guard' }
    return { ...state, retrievedChunks: retrieved }
  }

  if (state.selectedAction === 'quizGenerationTool') {
    const topic = (state.toolArgs as any)?.topic || ''
    const retrieved = await retrieveChunks(topic, 10)
    const guard = ensureChunks(retrieved, 'No sufficient context to generate quiz.')
    if (guard) return { ...state, toolResult: guard, guardStop: true, mode: 'guard' }
    return { ...state, retrievedChunks: retrieved }
  }

  if (state.selectedAction === 'quizEvaluationTool') {
    const attemptId = (state.toolArgs as any)?.attemptId
    const attemptCheck = await ensureAttempt(attemptId)
    if (!attemptCheck.ok) return { ...state, toolResult: attemptCheck, guardStop: true, mode: 'guard' }
  }

  return state
}

const workflow = new StateGraph(MessagesState)
  .addNode('llmCall', llmCall)
  .addNode('guardNode', guardNode)
  .addNode('toolNode', toolNode)
  .addEdge(START, 'llmCall')
  .addEdge('llmCall', 'guardNode')
  .addConditionalEdges('guardNode', (s) => (s.guardStop ? END : 'toolNode'), ['toolNode', END])
  .addEdge('toolNode', END)

const app = workflow.compile()

export type LearningGraphState = {
  messages: Array<any>
  llmCalls: number
  mode?: string
  toolResult?: any
  retrievedChunks?: any[]
}

type RunOptions = { userId?: string; sse?: (evt: any) => void }

export async function runLearningGraph(input: any, opts: RunOptions = {}): Promise<LearningGraphState> {
  const initialMessage =
    typeof input === 'string'
      ? new HumanMessage(input)
      : new HumanMessage(JSON.stringify(input))
  const state = await app.invoke({ messages: [initialMessage], userId: opts.userId }) as any
  if (opts.sse) {
    opts.sse({ type: 'DONE' })
  }
  // cache explain answers
  if ((state as any).selectedAction === 'explainTool' && state.toolResult?.answer) {
    const question = (state as any)?.toolArgs?.question || ''
    setCachedAnswer(cacheKey(question, 'default'), state.toolResult)
  }
  return state
}
