import { Router } from 'express'

const router = Router()

function writeEvent(res: any, payload: unknown) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

router.get('/', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  // Allow proxies to not buffer the response
  res.setHeader('X-Accel-Buffering', 'no')

  // Prevent request from timing out during streaming
  req.socket.setTimeout(0)

  const message = (req.query.message as string) || 'Analyzing your request'
  const answer = (req.query.answer as string) || 'This is a streamed answer.'

  try {
    // 1) Agent step
    writeEvent(res, { type: 'AGENT_STEP', message })

    // 2) Stream tokens for the answer
    const tokens = answer.split(/\s+/).filter(Boolean)
    for (const t of tokens) {
      writeEvent(res, { type: 'ANSWER_TOKEN', token: t })
      // Small delay to simulate streaming
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 30))
    }

    // 3) Done
    writeEvent(res, { type: 'DONE' })
  } catch (err) {
    writeEvent(res, { type: 'ERROR', error: 'Stream failed' })
  } finally {
    res.end()
  }
})

export default router
