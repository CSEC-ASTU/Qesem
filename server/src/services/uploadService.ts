import { parseUploadFile } from './fileParseService.js'
import { embedAndStoreChunks } from './chunkService.js'
import { RateLimitError } from '../utils/embedText.js'

export async function processUpload(mime: string, originalname: string, buffer: Buffer) {
  const pagesAll = await parseUploadFile(mime, buffer)
  if (!pagesAll.length) {
    return { success: false, reason: 'File is empty or unreadable', saved: 0 }
  }
  const maxPages = Number(process.env.MAX_PDF_PAGES ?? '20')
  const pages = pagesAll.slice(0, Math.max(1, maxPages))
  try {
    const { saved } = await embedAndStoreChunks(originalname, pages)
    return { success: saved > 0, saved }
  } catch (err) {
    if (err instanceof RateLimitError) {
      return {
        success: false,
        reason: 'Rate limited by Voyage AI. Please try again later.',
        saved: 0
      }
    }
    throw err
  }
}
