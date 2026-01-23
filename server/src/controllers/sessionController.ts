import { Request, Response } from 'express'
import ChatSession from '../models/ChatSession.js'

export async function postSession(req: Request, res: Response) {
  try {
    const { userId, topic, messages, summary } = req.body || {}
    const session = await ChatSession.create({ userId, topic, messages: messages || [], summary })
    return res.json({ ok: true, session })
  } catch (err) {
    console.error('postSession error:', err)
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ ok: false, error: message })
  }
}

export async function listSessions(_req: Request, res: Response) {
  try {
    const sessions = await ChatSession.find({}).sort({ createdAt: -1 }).limit(50).lean().exec()
    return res.json({ ok: true, sessions })
  } catch (err) {
    console.error('listSessions error:', err)
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ ok: false, error: message })
  }
}

export async function getSession(req: Request, res: Response) {
  try {
    const session = await ChatSession.findById(req.params.id).lean().exec()
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' })
    return res.json({ ok: true, session })
  } catch (err) {
    console.error('getSession error:', err)
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ ok: false, error: message })
  }
}

export async function appendSession(req: Request, res: Response) {
  try {
    const { messages } = req.body || {}
    const session = await ChatSession.findById(req.params.id)
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' })
    if (Array.isArray(messages)) {
      session.messages.push(...messages)
    }
    await session.save()
    return res.json({ ok: true, session })
  } catch (err) {
    console.error('appendSession error:', err)
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ ok: false, error: message })
  }
}
