export type ExplainLevel = 'ELI5' | 'ELI15' | 'EXAM'

export interface ChunkLike {
  content: string
  documentName?: string
  pageNumber?: number
  chunkIndex?: number
}

function styleInstructions(level: ExplainLevel): string {
  switch (level) {
    case 'ELI5':
      return [
        'Use simple language and short sentences.',
        'Use analogies only when directly grounded in the context.',
        'Avoid jargon; keep it concise (5–7 sentences).'
      ].join(' ')
    case 'ELI15':
      return [
        'Explain clearly with brief examples.',
        'Keep a balanced depth; be concise and precise.'
      ].join(' ')
    case 'EXAM':
      return [
        'Use structured, academic tone.',
        'Prefer bullet points and clear sections.',
        'Define key terms and outline steps.'
      ].join(' ')
    default:
      return ''
  }
}

/**
 * Build a strict prompt that uses ONLY retrieved context chunks.
 * If the answer is not supported by the context, instruct the model to respond:
 * "I can’t find this in your notes." (client may also guard empty context separately)
 */
export function buildPrompt(
  level: ExplainLevel,
  question: string,
  chunks: ChunkLike[]
): string {
  const context = chunks
    .map((c) => {
      const meta: string[] = []
      if (c.documentName) meta.push(`doc: ${c.documentName}`)
      if (typeof c.pageNumber === 'number') meta.push(`p: ${c.pageNumber}`)
      if (typeof c.chunkIndex === 'number') meta.push(`chunk: ${c.chunkIndex}`)
      const metaStr = meta.length ? ` (${meta.join(', ')})` : ''
      return `- ${c.content.trim()}${metaStr}`
    })
    .join('\n')

  const rules = [
    'Use ONLY the Context section below.',
    'Do NOT use external knowledge or unstated assumptions.',
    'If the Context does not contain enough information, answer exactly: "I can’t find this in your notes."'
  ].join(' ')

  const style = styleInstructions(level)

  return [
    `System: ${rules} ${style}`,
    '',
    `Question: ${question.trim()}`,
    '',
    'Context:',
    context || '- (no context provided)',
    '',
    'Answer:'
  ].join('\n')
}
