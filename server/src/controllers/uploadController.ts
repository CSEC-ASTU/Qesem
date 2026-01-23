import { Request, Response } from 'express'
import { processUpload } from '../services/uploadService.js'

export async function postUpload(req: Request, res: Response) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    const { originalname, buffer, mimetype } = req.file
    const outcome = await processUpload(mimetype, originalname, buffer)

    if (!outcome.success) {
      return res.status(400).json({ error: outcome.reason || 'Failed to process file' })
    }

    res.json({ success: true, chunksSaved: outcome.saved })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to process file' })
  }
}
