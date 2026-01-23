import { embedText } from '../utils/embedText.js'
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

  const docsWithEmbeddings: DocumentChunkAttrs[] = []
  for (const doc of chunked) {
    const embedding = await embedText(doc.content)
    if (!embedding.length) continue
    docsWithEmbeddings.push({ ...doc, documentName, embedding })
  }

  if (!docsWithEmbeddings.length) return { saved: 0 }

  await insertChunks(docsWithEmbeddings)
  return { saved: docsWithEmbeddings.length }
}
