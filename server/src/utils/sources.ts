import { RetrievedChunk } from './rag.js'

export interface SourceItem {
  documentName: string
  pageNumber: number
  chunkIndex: number
  score: number
  snippet: string
}

/**
 * Format retrieved chunks into a frontend-friendly sources array.
 * - Trims content to a short snippet for preview
 * - Keeps essential metadata for attribution
 */
export function formatSourcesForClient(chunks: RetrievedChunk[], options?: { snippetChars?: number }): SourceItem[] {
  const maxChars = options?.snippetChars ?? 180
  return (chunks || []).map((c) => ({
    documentName: c.documentName,
    pageNumber: c.pageNumber,
    chunkIndex: c.chunkIndex,
    score: Number(c.score || 0),
    snippet: (c.content || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxChars)
  }))
}
