import { vectorSearchChunks, RetrievedChunk } from '../utils/rag.js'
import { formatSourcesForClient, SourceItem } from '../utils/sources.js'

export async function retrieveChunks(query: string, topK = 5): Promise<RetrievedChunk[]> {
  if (!query?.trim()) return []
  return vectorSearchChunks(query, { topK })
}

export async function getSourcesForQuery(query: string, topK = 5): Promise<SourceItem[]> {
  const retrieved = await retrieveChunks(query, topK)
  return formatSourcesForClient(retrieved)
}
