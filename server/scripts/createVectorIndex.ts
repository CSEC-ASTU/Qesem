import mongoose from 'mongoose'
import 'dotenv/config'
import DocumentChunk from '../src/models/DocumentChunk.js'
import dotenv from 'dotenv'

dotenv.config()

async function resolveDimensions(): Promise<number> {
  const envDim = process.env.MONGO_VECTOR_DIM ? Number(process.env.MONGO_VECTOR_DIM) : undefined

  let inferred: number | undefined
  try {
    const sample = await DocumentChunk.findOne(
      { embedding: { $exists: true, $ne: [] } },
      { embedding: { $slice: 1 } }
    )
      .lean()
      .exec()
    if (sample && Array.isArray((sample as any).embedding)) {
      inferred = (sample as any).embedding.length
    }
  } catch (err) {
    console.warn('Could not infer embedding dimensions from existing documents:', err)
  }

  if (envDim && inferred && envDim !== inferred) {
    console.warn(
      `Warning: MONGO_VECTOR_DIM=${envDim} differs from sample embedding length ${inferred}; using env value.`
    )
  }

  return envDim ?? inferred ?? 1024
}
async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set')
  }

  const indexName = process.env.MONGO_VECTOR_INDEX || 'vector_index'
  const numDimensions = await resolveDimensions()
  const similarity = process.env.MONGO_VECTOR_SIMILARITY || 'cosine'

  await mongoose.connect(uri)
  const db = mongoose.connection.db
  if (!db) {
    throw new Error('MongoDB connection is not available')
  }

  const collectionName = DocumentChunk.collection.name
  try {
    await db.command({ dropSearchIndex: collectionName, name: indexName })
    console.log(`Dropped existing search index "${indexName}" (if it existed).`)
  } catch (err) {
    console.warn(`Could not drop search index "${indexName}" (may not exist yet):`, err)
  }
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
  .catch(async (err: any) => {
    if (err?.codeName === 'IndexAlreadyExists' || err?.code === 68) {
      console.warn(
        `Index "${process.env.MONGO_VECTOR_INDEX || 'vector_index'}" already exists. Drop it manually from Atlas or choose a new name via MONGO_VECTOR_INDEX, then rerun.`
      )
      await mongoose.connection.close().catch(() => undefined)
      process.exitCode = 1
      return
    }
    console.error('Failed to create vector index:', err)
    await mongoose.connection.close().catch(() => undefined)
    process.exitCode = 1
  })
