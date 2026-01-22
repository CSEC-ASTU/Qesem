import { Schema, model } from 'mongoose'

export interface DocumentChunkAttrs {
  documentName: string
  pageNumber: number
  chunkIndex: number
  content: string
  embedding: number[]
}

const documentChunkSchema = new Schema<DocumentChunkAttrs>(
  {
    documentName: { type: String, required: true, index: true },
    pageNumber: { type: Number, required: true },
    chunkIndex: { type: Number, required: true },
    content: { type: String, required: true },
    embedding: { type: [Number], required: true }
  },
  { timestamps: true }
)

const DocumentChunk = model<DocumentChunkAttrs>('DocumentChunk', documentChunkSchema)

export default DocumentChunk
