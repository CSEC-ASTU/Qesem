import { Request, Response } from 'express'
import { PDFParse } from 'pdf-parse'
import DocumentChunk from '../models/DocumentChunk.js'
import { embedText } from '../utils/embedText.js'

export async function postUpload(req: Request, res: Response) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    const { originalname, buffer } = req.file
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    await parser.destroy()

    const text = result.text || ''
    if (!text.trim()) {
      return res.status(400).json({ error: 'PDF text is empty' })
    }

    const words = text.split(/\s+/).filter(Boolean)
    const chunkSize = 400 // target within 300–500 words
    const docs = words.reduce<
      Array<{ documentName: string; pageNumber: number; chunkIndex: number; content: string }>
    >((acc, _word, idx) => {
      if (idx % chunkSize === 0) {
        const slice = words.slice(idx, idx + chunkSize)
        const chunkIndex = acc.length
        const pageNumber = Math.min(result.total ?? 1, chunkIndex + 1)
        acc.push({
          documentName: originalname,
          pageNumber,
          chunkIndex,
          content: slice.join(' ')
        })
      }
      return acc
    }, [])

    // Embed each chunk sequentially to respect provider limits
    const docsWithEmbeddings = [] as Array<{
      documentName: string
      pageNumber: number
      chunkIndex: number
      content: string
      embedding: number[]
    }>

    for (const doc of docs) {
      const embedding = await embedText(doc.content)
      if (!embedding.length) continue
      docsWithEmbeddings.push({ ...doc, embedding })
    }

    if (!docsWithEmbeddings.length) {
      return res.status(500).json({ error: 'Failed to generate embeddings' })
    }

    await DocumentChunk.insertMany(docsWithEmbeddings)

    res.json({ success: true, chunksSaved: docsWithEmbeddings.length })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to process PDF' })
  }
}
