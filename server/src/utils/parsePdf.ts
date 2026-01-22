import { PDFParse } from 'pdf-parse'

export interface PageText {
  pageNumber: number
  text: string
}

/**
 * Parse a PDF buffer and return page-wise text.
 * Splits on form feeds emitted by pdf.js; safely handles empty or corrupted PDFs.
 */
export async function parsePdfBuffer(buffer: Buffer): Promise<PageText[]> {
  if (!buffer || buffer.length === 0) {
    return []
  }

  try {
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    await parser.destroy()

    const raw = result.text || ''
    if (!raw.trim()) {
      return []
    }

    const pages = raw.split('\f').map((p) => p.trim()).filter(Boolean)
    return pages.map((text, idx) => ({ pageNumber: idx + 1, text }))
  } catch (err) {
    console.error('Failed to parse PDF', err)
    return []
  }
}
