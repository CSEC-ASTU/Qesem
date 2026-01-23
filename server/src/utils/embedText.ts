interface EmbedOptions {
  apiKey?: string
  model?: string
  baseUrl?: string
  inputType?: 'query' | 'document' | null
  outputDimension?: number
}

/**
 * Generate vector embeddings for a given text using Voyage AI.
 * Minimal provider logic; returns [] on empty text or missing embedding.
 */
export class RateLimitError extends Error {
  retryAfterMs?: number
  constructor(message: string, retryAfterMs?: number) {
    super(message)
    this.name = 'RateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}

async function requestEmbeddings(
  inputs: string[],
  options: EmbedOptions
): Promise<Array<number[]>> {
  const apiKey = options.apiKey ?? process.env.VOYAGE_API_KEY
  const model = options.model ?? process.env.VOYAGE_EMBED_MODEL ?? 'voyage-4-lite'
  const baseUrl = options.baseUrl ?? 'https://api.voyageai.com/v1'
  const inputType = options.inputType ?? 'document'
  const outputDimension = options.outputDimension

  if (!apiKey) {
    throw new Error('Missing Voyage API key (set VOYAGE_API_KEY)')
  }

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: inputs,
      input_type: inputType,
      output_dimension: outputDimension
    })
  })

  if (response.status === 429) {
    const retryAfterHeader = response.headers.get('retry-after')
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined
    const body = await response.text().catch(() => '')
    throw new RateLimitError(
      `Embedding request failed: 429 Too Many Requests ${body}`,
      retryAfterMs
    )
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Embedding request failed: ${response.status} ${response.statusText} ${body}`)
  }

  const json = (await response.json()) as { data?: Array<{ embedding: number[] }> }
  const embeddings = (json.data ?? []).map((d) => d.embedding ?? [])
  return embeddings
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Batch embed multiple texts with retry and exponential backoff on 429.
 */
export async function embedTexts(
  texts: string[],
  options: EmbedOptions = {}
): Promise<Array<number[]>> {
  const filtered = texts.map((t) => (t?.trim() ? t : '')).filter((t) => t.length > 0)
  if (!filtered.length) return []

  const maxRetries = Number(process.env.VOYAGE_EMBED_MAX_RETRIES ?? '8')
  const baseDelayMs = Number(process.env.VOYAGE_EMBED_INITIAL_DELAY_MS ?? '5000')

  let attempt = 0
  while (true) {
    try {
      return await requestEmbeddings(filtered, options)
    } catch (err) {
      attempt += 1
      const isRateLimit = err instanceof RateLimitError
      if (attempt > maxRetries || (!isRateLimit && attempt > 1)) {
        throw err
      }
      const jitter = Math.floor(Math.random() * 500)
      const retryAfterMs = isRateLimit && err.retryAfterMs ? err.retryAfterMs : 0
      const delay = retryAfterMs || baseDelayMs * Math.pow(2, attempt - 1) + jitter
      await sleep(delay)
    }
  }
}

/**
 * Single-text convenience wrapper.
 */
export async function embedText(text: string, options: EmbedOptions = {}): Promise<number[]> {
  const res = await embedTexts([text], options)
  return res[0] ?? []
}
