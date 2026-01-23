import { Request, Response } from 'express'
import { retrieveChunks } from '../services/retrievalService.js'
import { buildQuizFromChunks } from '../services/quizService.js'
import { getAnswer } from '../utils/quiz.js'
import { evaluateAnswer } from '../utils/evaluate.js'
import QuizAttempt from '../models/QuizAttempt.js'

export async function postQuizAuto(req: Request, res: Response) {
  try {
    const { topic, difficulty, questionCount, questionType } = req.body || {}
    if (!topic || typeof topic !== 'string') {
      return res.status(400).json({ ok: false, error: 'topic is required' })
    }

    const retrieved = await retrieveChunks(topic, 10)
    if (!retrieved.length) {
      return res.status(400).json({ ok: false, error: 'No content found for topic' })
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
      difficulty,
      questionCount: questionCount || questions.length,
      questionType,
      questions: storedQuestions
    })

    // return questions without answers
    const responseQuestions = storedQuestions.map((q) => ({
      questionId: q.questionId,
      prompt: q.prompt,
      type: q.type,
      options: q.options
    }))

    return res.json({ ok: true, attemptId: attempt._id, questions: responseQuestions })
  } catch (err) {
    console.error('postQuizAuto error:', err)
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ ok: false, error: message })
  }
}

export async function postQuizAutoEvaluate(req: Request, res: Response) {
  try {
    const { attemptId, responses } = req.body || {}
    if (!attemptId || !Array.isArray(responses)) {
      return res.status(400).json({ ok: false, error: 'attemptId and responses are required' })
    }

    const attempt = await QuizAttempt.findById(attemptId)
    if (!attempt) {
      return res.status(404).json({ ok: false, error: 'Attempt not found' })
    }

    let correct = 0
    const feedback = [] as Array<{ questionId: string; result: string; explanation: string }>
    const weakAreas: string[] = []

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

    return res.json({
      ok: true,
      score: attempt.score,
      weakAreas,
      feedback,
      questions: attempt.questions.map((q) => ({
        questionId: q.questionId,
        result: q.result,
        feedback: q.feedback
      }))
    })
  } catch (err) {
    console.error('postQuizAutoEvaluate error:', err)
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ ok: false, error: message })
  }
}
