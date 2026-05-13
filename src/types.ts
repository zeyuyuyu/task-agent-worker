export interface Env {
  DB: D1Database;
  VECTORIZE?: VectorizeIndex;
  FILE_BUCKET?: R2Bucket;
  APP_NAME?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_EMBEDDING_MODEL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  SERPER_API_KEY?: string;
  QDRANT_URL?: string;
  QDRANT_API_KEY?: string;
  QDRANT_COLLECTION?: string;
}

export interface User {
  id: string;
  session_id: string;
  name: string | null;
  email: string | null;
  ai_nickname: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  status: "open" | "doing" | "done" | "archived";
  due_date: string | null;
  created_at: string;
  updated_at: string;
  requirements?: TaskRequirement[];
}

export interface TaskRequirement {
  id: string;
  task_id: string;
  body: string;
  status: "open" | "done";
  created_at: string;
}

export interface WorkspaceFile {
  id: string;
  user_id: string;
  name: string;
  mime_type: string;
  size: number;
  summary: string | null;
  storage_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface RetrievedContext {
  id: string;
  source: "file" | "memory";
  score: number;
  title: string;
  content: string;
}

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

export const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
};
