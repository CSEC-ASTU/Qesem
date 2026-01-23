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

export type UiMode = "chat" | "quiz" | "results";

export interface QuizQuestion {
  questionId: string;
  prompt: string;
  type?: "short" | "mcq" | string;
  options?: string[];
}

export interface QuizResult {
  attemptId?: string;
  score?: number;
  feedback?: Array<{ questionId: string; result: string; explanation?: string }>;
  weakAreas?: string[];
}

export interface ActiveQuiz {
  attemptId?: string;
  questions: QuizQuestion[];
}

interface ChatState {
  messages: Message[];
  sessions: SessionItem[];
  activeSessionId?: string;
  streaming: boolean;
  uiMode: UiMode;
  activeQuiz?: ActiveQuiz;
  quizResponses: Record<string, string>;
  quizResult?: QuizResult;
  setSessions: (sessions: SessionItem[]) => void;
  setActiveSession: (id: string | undefined) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (msg: Message) => void;
  updateMessage: (id: string, partial: Partial<Message>) => void;
  removeMessage: (id: string) => void;
  appendMessage: (id: string, text: string) => void;
  resetMessages: () => void;
  setStreaming: (value: boolean) => void;
  setUiMode: (mode: UiMode) => void;
  setActiveQuiz: (quiz: ActiveQuiz | undefined) => void;
  setQuizResult: (result: QuizResult | undefined) => void;
  setQuizResponses: (responses: Record<string, string>) => void;
  updateQuizResponse: (questionId: string, value: string) => void;
  clearQuiz: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  sessions: [],
  activeSessionId: undefined,
  streaming: false,
  uiMode: "chat",
  activeQuiz: undefined,
  quizResponses: {},
  quizResult: undefined,
  setSessions: (sessions) => set(() => ({ sessions })),
  setActiveSession: (id) => set(() => ({ activeSessionId: id })),
  setMessages: (messages) => set(() => ({ messages })),
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  updateMessage: (id, partial) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, ...partial } : m)),
    })),
  removeMessage: (id) =>
    set((state) => ({ messages: state.messages.filter((m) => m.id !== id) })),
  appendMessage: (id, text) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, content: `${m.content}${text}` } : m
      ),
    })),
  resetMessages: () => set(() => ({ messages: [] })),
  setStreaming: (value) => set(() => ({ streaming: value })),
  setUiMode: (mode) => set(() => ({ uiMode: mode })),
  setActiveQuiz: (quiz) =>
    set(() => ({
      activeQuiz: quiz,
      quizResult: quiz ? undefined : undefined,
      uiMode: quiz ? "quiz" : "chat",
      quizResponses: quiz ? {} : {},
    })),
  setQuizResult: (quizResult) => set(() => ({ quizResult })),
  setQuizResponses: (quizResponses) => set(() => ({ quizResponses })),
  updateQuizResponse: (questionId, value) =>
    set((state) => ({ quizResponses: { ...state.quizResponses, [questionId]: value } })),
  clearQuiz: () =>
    set(() => ({
      activeQuiz: undefined,
      quizResult: undefined,
      quizResponses: {},
      uiMode: "chat",
    })),
}));
