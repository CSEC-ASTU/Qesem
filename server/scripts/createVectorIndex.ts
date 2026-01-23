import mongoose from 'mongoose'
import 'dotenv/config'
import DocumentChunk from '../src/models/DocumentChunk.js'
import dotenv from 'dotenv'

dotenv.config()
async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set')
  }

  const indexName = process.env.MONGO_VECTOR_INDEX || 'vector_index'
  const numDimensions = Number(process.env.MONGO_VECTOR_DIM || '1536')
  const similarity = process.env.MONGO_VECTOR_SIMILARITY || 'cosine'

  await mongoose.connect(uri)
  const db = mongoose.connection.db
  if (!db) {
    throw new Error('MongoDB connection is not available')
  }

  const collectionName = DocumentChunk.collection.name
  // Atlas Vector Search expects mappings with knnVector fields
  const definition = {
    mappings: {
      dynamic: true,
      fields: {
        embedding: {
          type: 'knnVector',
          dimensions: numDimensions,
          similarity
        },
        documentName: { type: 'string' }
      }
    }
  }

  const command = {
    createSearchIndexes: collectionName,
    indexes: [
      {
        name: indexName,
        definition
      }
    ]
  }

  const result = await db.command(command)
  console.log('createSearchIndexes result:', JSON.stringify(result, null, 2))
  console.log(
    `Vector index "${indexName}" ensured on collection "${collectionName}" with ${numDimensions} dims (${similarity}).`
  )
}

main()
  .then(() => mongoose.connection.close())
  .catch(async (err) => {
    console.error('Failed to create vector index:', err)
    await mongoose.connection.close().catch(() => undefined)
    process.exitCode = 1
  })
