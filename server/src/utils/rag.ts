import DocumentChunk from '../models/DocumentChunk.js'
import { embedText } from './embedText.js'

export interface VectorSearchOptions {
  similarityThreshold?: number
  topK?: number
  numCandidates?: number
  indexName?: string
  filter?: Record<string, unknown>
}

/**
 * Retrieve top chunks using MongoDB vector search (cosine similarity via $vectorSearch).
 */
export async function vectorSearchChunks(query: string, options: VectorSearchOptions = {}) {
  const threshold = options.similarityThreshold ?? 0.3
  const topK = options.topK ?? 3
  const numCandidates = options.numCandidates ?? Math.max(topK * 20, 100)
  const index = options.indexName ?? process.env.MONGO_VECTOR_INDEX ?? 'vector_index'
  const filter = options.filter

  if (!query.trim()) return []

  const queryEmbedding = await embedText(query)
  if (!queryEmbedding.length) return []

  const pipeline = [
    {
      $vectorSearch: {
        index,
        path: 'embedding',
        queryVector: queryEmbedding,
        similarity: 'cosine',
        numCandidates,
        limit: topK,
        filter
      }
    },
    {
      $project: {
        content: 1,
        documentName: 1,
        pageNumber: 1,
        chunkIndex: 1,
        score: { $meta: 'vectorSearchScore' }
      }
    },
    {
      $match: { score: { $gte: threshold } }
    },
    {
      $sort: { score: -1 }
    }
  ]

  return DocumentChunk.aggregate(pipeline as any).exec()
}


export interface GuardResult {
  allowed: boolean
  message?: string
}

/**
 * Prevent hallucinated answers by requiring non-empty retrieval results.
 */
export function guardRetrievedChunks<T>(retrievedChunks: T[]): GuardResult {
  if (!Array.isArray(retrievedChunks) || retrievedChunks.length === 0) {
    return { allowed: false, message: 'I can’t find this in your notes.' }
  }
  return { allowed: true }
}

