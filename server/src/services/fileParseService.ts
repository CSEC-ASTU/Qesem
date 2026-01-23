import { PDFParse } from 'pdf-parse'
import { PageText } from './chunkService.js'

function bufferToUtf8(buffer: Buffer) {
  return buffer.toString('utf-8')
}

async function parsePdf(buffer: Buffer): Promise<PageText[]> {
  const parser = new PDFParse({ data: buffer })
  const result = await parser.getText()
  await parser.destroy()

  const text = result.text || ''
  if (!text.trim()) return []

  // pdf-parse often separates pages with form-feed characters (\f); fall back to whole text
  const pages = text.split(/\f+/).filter(Boolean)
  if (!pages.length) return [{ pageNumber: 1, text }]

  return pages.map((t, idx) => ({ pageNumber: idx + 1, text: t }))
}

function parseTxt(buffer: Buffer): PageText[] {
  const text = bufferToUtf8(buffer)
  if (!text.trim()) return []
  // Treat text as a single page; client could pass synthetic page markers later if needed
  return [{ pageNumber: 1, text }]
}

export async function parseUploadFile(mime: string, buffer: Buffer): Promise<PageText[]> {
  if (mime === 'application/pdf') return parsePdf(buffer)
  if (mime === 'text/plain') return Promise.resolve(parseTxt(buffer))
  throw new Error('Unsupported file type')
}
