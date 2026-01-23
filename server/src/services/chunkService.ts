import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
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

export async function chunkPagesToDocuments(
  pages: PageText[],
  options: ChunkOptions = {}
) {
  const chunkSize = options.chunkSize ?? 800
  const overlap = options.overlap ?? 120
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: overlap,
    separators: ['\n\n', '\n', ' ', '']
  })

  const chunks: Array<Omit<DocumentChunkAttrs, 'embedding'>> = []

  for (const page of pages) {
    if (!page.text?.trim()) continue
    const pieces = await splitter.splitText(page.text)
    pieces.forEach((content) => {
      const cleaned = content.trim()
      if (!cleaned) return
      chunks.push({
        documentName: '', // filled later
        pageNumber: page.pageNumber,
        chunkIndex: chunks.length,
        content: cleaned
      })
    })
  }

  return chunks
}

export async function embedAndStoreChunks(
  documentName: string,
  pages: PageText[],
  options: ChunkOptions = {}
) {
  const chunked = await chunkPagesToDocuments(pages, options)
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
