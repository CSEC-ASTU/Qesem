import DocumentChunk, { DocumentChunkAttrs } from '../models/DocumentChunk.js'

export async function insertChunks(chunks: DocumentChunkAttrs[]) {
  return DocumentChunk.insertMany(chunks)
}

export async function listAllChunks() {
  return DocumentChunk.find({}).lean().exec()
}

export async function listChunksByDocument(documentName: string) {
  return DocumentChunk.find({ documentName }).lean().exec()
}
