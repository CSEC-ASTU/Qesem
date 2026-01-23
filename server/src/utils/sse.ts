import { Response } from 'express'

export interface SseChannel {
  writeEvent: (payload: Record<string, any>) => void
  close: () => void
}

export function initSse(res: Response): SseChannel {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const writeEvent = (payload: Record<string, any>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  const close = () => {
    try {
      res.end()
    } catch {
      /* ignore */
    }
  }

  const interval = setInterval(() => writeEvent({ type: 'PING', ts: Date.now() }), 20000)
  res.on('close', () => {
    clearInterval(interval)
    close()
  })

  return { writeEvent, close }
}
