const GOOGLE_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models'

function getApiKey() {
  const key = process.env.GOOGLE_API_KEY
  if (!key) throw new Error('GOOGLE_API_KEY is required')
  return key
}

function getModel() {
  return process.env.GEMINI_MODEL || 'gemini-1.5-flash'
}

function buildRequestBody(prompt: string) {
  return {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: { temperature: 0.4 }
  }
}

export async function completeChat(prompt: string): Promise<string> {
  const apiKey = getApiKey()
  const model = getModel()
  const url = `${GOOGLE_API_ROOT}/${encodeURIComponent(model)}:generateContent?key=${apiKey}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequestBody(prompt))
  })

  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`LLM request failed: ${res.status} ${txt}`)
  }

  const json = await res.json()
  const parts = json?.candidates?.[0]?.content?.parts || []
  const text = parts.map((p: any) => p?.text || '').join('')
  return text || ''
}

export async function* streamChatCompletion(prompt: string): AsyncGenerator<string> {
  const apiKey = getApiKey()
  const model = getModel()
  const url = `${GOOGLE_API_ROOT}/${encodeURIComponent(model)}:streamGenerateContent?key=${apiKey}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequestBody(prompt))
  })

  if (!res.body || !res.ok) {
    const txt = await res.text()
    throw new Error(`LLM stream failed: ${res.status} ${txt}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const obj = JSON.parse(trimmed)
        const parts = obj?.candidates?.[0]?.content?.parts || []
        for (const p of parts) {
          const t = p?.text
          if (t) yield t
        }
      } catch {
        // ignore non-JSON lines
      }
    }
  }
}
