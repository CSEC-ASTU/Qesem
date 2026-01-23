import { Schema, model } from 'mongoose'

export interface UserMemoryAttrs {
  userId: string
  weakTopics: string[]
  preferredDifficulty?: string
  notes?: string
}

const userMemorySchema = new Schema<UserMemoryAttrs>(
  {
    userId: { type: String, required: true, unique: true },
    weakTopics: { type: [String], default: [] },
    preferredDifficulty: { type: String },
    notes: { type: String }
  },
  { timestamps: true }
)

const UserMemory = model<UserMemoryAttrs>('UserMemory', userMemorySchema)
export default UserMemory
