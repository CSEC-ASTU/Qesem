import { create } from "zustand";

export type Role = "user" | "assistant";

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  streaming?: boolean;
}

export interface SessionItem {
  id: string;
  title: string;
  time?: string;
}

export interface QuizQuestion {
  questionId: string;
  prompt: string;
  type?: string;
  options?: string[];
}

export interface QuizResult {
  attemptId?: string;
  score?: number;
  feedback?: Array<{ questionId: string; result: string; explanation?: string }>;
}

interface ChatState {
  messages: Message[];
  sessions: SessionItem[];
  activeSessionId?: string;
  streaming: boolean;
  quizQuestions: QuizQuestion[];
  quizResult?: QuizResult;
  setSessions: (sessions: SessionItem[]) => void;
  setActiveSession: (id: string | undefined) => void;
  addMessage: (msg: Message) => void;
  updateMessage: (id: string, partial: Partial<Message>) => void;
  appendMessage: (id: string, text: string) => void;
  resetMessages: () => void;
  setStreaming: (value: boolean) => void;
  setQuizState: (questions: QuizQuestion[], result?: QuizResult) => void;
  clearQuiz: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  sessions: [],
  activeSessionId: undefined,
  streaming: false,
  quizQuestions: [],
  quizResult: undefined,
  setSessions: (sessions) => set(() => ({ sessions })),
  setActiveSession: (id) => set(() => ({ activeSessionId: id })),
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  updateMessage: (id, partial) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, ...partial } : m)),
    })),
  appendMessage: (id, text) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, content: `${m.content}${text}` } : m
      ),
    })),
  resetMessages: () => set(() => ({ messages: [] })),
  setStreaming: (value) => set(() => ({ streaming: value })),
  setQuizState: (questions, result) => set(() => ({ quizQuestions: questions, quizResult: result })),
  clearQuiz: () => set(() => ({ quizQuestions: [], quizResult: undefined })),
}));
