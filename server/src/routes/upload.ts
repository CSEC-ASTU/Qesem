import { Router } from 'express'
import multer from 'multer'
import { postUpload } from '../controllers/uploadController.js'

const maxUploadMb = Number(process.env.MAX_UPLOAD_MB ?? '5')
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (!['application/pdf', 'text/plain'].includes(file.mimetype)) {
      return cb(new Error('Only PDF or TXT files are allowed'))
    }
    cb(null, true)
  },
  limits: { fileSize: Math.max(1, maxUploadMb) * 1024 * 1024 } // default 5MB, configurable via MAX_UPLOAD_MB
})

const router = Router()

router.post('/', upload.single('file'), postUpload)

export default router
