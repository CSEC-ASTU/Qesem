import { z } from 'zod'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { tool } from '@langchain/core/tools'
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'

import { getExplainAnswer } from '../services/explainService.js'
import { retrieveChunks } from '../services/retrievalService.js'
import { buildQuizFromChunks } from '../services/quizService.js'
import { getAnswer } from '../utils/quiz.js'
import { evaluateAnswer } from '../utils/evaluate.js'
import QuizAttempt from '../models/QuizAttempt.js'

const LearningState = Annotation.Root({
  userInput: Annotation<any>(),
  selectedAction: Annotation<string | undefined>(),
  toolArgs: Annotation<Record<string, any> | undefined>(),
  toolResult: Annotation<any>(),
  retrievedChunks: Annotation<any[] | undefined>()
})
type LearningStateType = typeof LearningState.State

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

const model = new ChatGoogleGenerativeAI({
  model: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
  apiKey: process.env.GOOGLE_API_KEY,
  temperature: 0.2
}).bindTools(tools)

async function agentNode(state: LearningStateType): Promise<Partial<LearningStateType>> {
  const userInput = state.userInput
  const prompt = typeof userInput === 'string' ? userInput : JSON.stringify(userInput)
  const res = await model.invoke([{ role: 'user', content: prompt }])
  const call = res.tool_calls?.[0]
  if (!call) {
    throw new Error('Agent did not select a tool')
  }
  return { selectedAction: call.name, toolArgs: call.args }
}

async function toolNode(state: LearningStateType): Promise<Partial<LearningStateType>> {
  if (!state.selectedAction) throw new Error('No selected action to execute')
  const t = tools.find((t) => t.name === state.selectedAction)
  if (!t) throw new Error(`Unknown tool: ${state.selectedAction}`)
  const result = await (t as any).invoke(state.toolArgs || {})
  const retrieved = (result as any)?.retrieved || undefined
  return { toolResult: result, retrievedChunks: retrieved }
}

const workflow = new StateGraph(LearningState)
  .addNode('agent', agentNode)
  .addNode('tool', toolNode)
  .addEdge(START, 'agent')
  .addEdge('agent', 'tool')
  .addEdge('tool', END)

const app = workflow.compile()

export type LearningGraphState = LearningStateType

export async function runLearningGraph(input: any): Promise<LearningGraphState> {
  return app.invoke({ userInput: input })
}
