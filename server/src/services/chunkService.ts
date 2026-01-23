import { embedTexts, RateLimitError } from '../utils/embedText.js'
import { insertChunks } from '../repositories/chunkRepository.js'
import { DocumentChunkAttrs } from '../models/DocumentChunk.js'

export interface PageText {
  pageNumber: number
  text: string
}

interface ChunkOptions {
  chunkSize?: number
  overlap?: number
}

export function chunkPagesToDocuments(pages: PageText[], options: ChunkOptions = {}) {
  const chunkSize = options.chunkSize ?? 100
  const overlap = options.overlap ?? 20
  const step = Math.max(1, chunkSize - overlap)
  const chunks: Array<Omit<DocumentChunkAttrs, 'embedding'>> = []

  pages.forEach((page) => {
    const words = page.text.split(/\s+/).filter(Boolean)
    for (let i = 0; i < words.length; i += step) {
      const slice = words.slice(i, i + chunkSize)
      chunks.push({
        documentName: '', // filled later
        pageNumber: page.pageNumber,
        chunkIndex: chunks.length,
        content: slice.join(' ')
      })
    }
  })

  return chunks
}

export async function embedAndStoreChunks(
  documentName: string,
  pages: PageText[],
  options: ChunkOptions = {}
) {
  const chunked = chunkPagesToDocuments(pages, options)
  const batchSize = Number(process.env.VOYAGE_EMBED_BATCH_SIZE ?? '16')
  const batchIntervalMs = Number(process.env.VOYAGE_EMBED_BATCH_INTERVAL_MS ?? '20000')

  const docsWithEmbeddings: DocumentChunkAttrs[] = []
  for (let i = 0; i < chunked.length; i += batchSize) {
    const batch = chunked.slice(i, i + batchSize)
    const contents = batch.map((d) => d.content)
    try {
      const embeddings = await embedTexts(contents)
      embeddings.forEach((emb, idx) => {
        if (Array.isArray(emb) && emb.length) {
          const doc = batch[idx]
          docsWithEmbeddings.push({ ...doc, documentName, embedding: emb })
        }
      })
    } catch (err) {
      if (err instanceof RateLimitError) {
        // Stop further embedding on rate limit; persist what we have.
        break
      }
      throw err
    }
    if (batchIntervalMs > 0 && i + batchSize < chunked.length) {
      await new Promise((r) => setTimeout(r, batchIntervalMs))
    }
  }

  if (!docsWithEmbeddings.length) return { saved: 0 }

  await insertChunks(docsWithEmbeddings)
  return { saved: docsWithEmbeddings.length }
}
