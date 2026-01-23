import { Schema, model } from 'mongoose'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: Date
}

export interface ChatSessionAttrs {
  userId?: string
  topic?: string
  messages: ChatMessage[]
  summary?: string
}

const messageSchema = new Schema<ChatMessage>(
  {
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: () => new Date() }
  },
  { _id: false }
)

const chatSessionSchema = new Schema<ChatSessionAttrs>(
  {
    userId: { type: String },
    topic: { type: String },
    messages: { type: [messageSchema], default: [] },
    summary: { type: String }
  },
  { timestamps: true }
)

const ChatSession = model<ChatSessionAttrs>('ChatSession', chatSessionSchema)
export default ChatSession
