import { parseUploadFile } from './fileParseService.js'
import { embedAndStoreChunks } from './chunkService.js'

export async function processUpload(mime: string, originalname: string, buffer: Buffer) {
  const pages = await parseUploadFile(mime, buffer)
  if (!pages.length) {
    return { success: false, reason: 'File is empty or unreadable', saved: 0 }
  }

  const { saved } = await embedAndStoreChunks(originalname, pages)
  return { success: saved > 0, saved }
}
