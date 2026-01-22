import { Router } from 'express'
import multer from 'multer'
import { PDFParse } from 'pdf-parse'
import DocumentChunk from '../models/DocumentChunk.js'

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed'))
    }
    cb(null, true)
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
})

const router = Router()

router.post('/', upload.single('file'), async (req, res) => {
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
    const docs = words.reduce<Array<{ documentName: string; pageNumber: number; chunkIndex: number; content: string }>>(
      (acc, _word, idx) => {
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
      },
      []
    )

    await DocumentChunk.insertMany(docs)

    res.json({ success: true, chunksSaved: docs.length })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to process PDF' })
  }
})

export default router
