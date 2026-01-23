import { Response } from 'express'

export interface SseChannel {
  send: (event: string, data: unknown) => void
  close: () => void
}

export function initSse(res: Response): SseChannel {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  const close = () => {
    try {
      res.end()
    } catch {
      /* ignore */
    }
  }

  // keep-alive
  const interval = setInterval(() => send('ping', Date.now()), 20000)
  res.on('close', () => {
    clearInterval(interval)
    close()
  })

  return { send, close }
}
