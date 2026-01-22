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
export async function embedText(text: string, options: EmbedOptions = {}): Promise<number[]> {
  if (!text?.trim()) return []

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
      input: [text],
      input_type: inputType,
      output_dimension: outputDimension
    })
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Embedding request failed: ${response.status} ${response.statusText} ${body}`)
  }

  const json = (await response.json()) as { data?: Array<{ embedding: number[] }> }
  const embedding = json.data?.[0]?.embedding
  return Array.isArray(embedding) ? embedding : []
}
