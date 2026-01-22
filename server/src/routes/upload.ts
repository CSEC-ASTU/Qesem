import { Router } from 'express'
import multer from 'multer'
import { postUpload } from '../controllers/uploadController.js'

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

router.post('/', upload.single('file'), postUpload)

export default router
