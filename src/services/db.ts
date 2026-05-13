import type { ChatMessage, Task, TaskRequirement, User, WorkspaceFile } from "../types";

export const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

export async function ensureUser(db: D1Database, sessionId: string): Promise<User> {
  const existing = await db.prepare("SELECT * FROM users WHERE session_id = ?").bind(sessionId).first<User>();
  if (existing) return existing;

  const id = uid("usr");
  await db
    .prepare("INSERT OR IGNORE INTO users (id, session_id, ai_nickname) VALUES (?, ?, ?)")
    .bind(id, sessionId, "Mira")
    .run();
  return (await db.prepare("SELECT * FROM users WHERE session_id = ?").bind(sessionId).first<User>())!;
}

export async function updateUser(
  db: D1Database,
  userId: string,
  patch: Partial<Pick<User, "name" | "email" | "ai_nickname">>
): Promise<User> {
  const current = (await db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<User>())!;
  await db
    .prepare("UPDATE users SET name = ?, email = ?, ai_nickname = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(patch.name ?? current.name, patch.email ?? current.email, patch.ai_nickname ?? current.ai_nickname, userId)
    .run();
  return (await db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<User>())!;
}

export async function saveConversation(db: D1Database, userId: string, role: ChatMessage["role"], content: string) {
  await db.prepare("INSERT INTO conversations (id, user_id, role, content) VALUES (?, ?, ?, ?)").bind(uid("msg"), userId, role, content).run();
}

export async function recentConversation(db: D1Database, userId: string, limit = 12): Promise<ChatMessage[]> {
  const rows = await db
    .prepare("SELECT role, content FROM conversations WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .bind(userId, limit)
    .all<ChatMessage>();
  return rows.results.reverse();
}

export async function listTasks(db: D1Database, userId: string): Promise<Task[]> {
  const tasks = (await db.prepare("SELECT * FROM tasks WHERE user_id = ? AND status != 'archived' ORDER BY updated_at DESC").bind(userId).all<Task>()).results;
  if (!tasks.length) return [];
  const reqs = (await db
    .prepare(`SELECT r.* FROM task_requirements r JOIN tasks t ON t.id = r.task_id WHERE t.user_id = ? ORDER BY r.created_at ASC`)
    .bind(userId)
    .all<TaskRequirement>()).results;
  const byTask = new Map<string, TaskRequirement[]>();
  for (const req of reqs) byTask.set(req.task_id, [...(byTask.get(req.task_id) ?? []), req]);
  return tasks.map((task) => ({ ...task, requirements: byTask.get(task.id) ?? [] }));
}

export async function listFiles(db: D1Database, userId: string): Promise<WorkspaceFile[]> {
  return (await db.prepare("SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all<WorkspaceFile>()).results;
}

export async function deleteFileRows(db: D1Database, userId: string, fileId: string): Promise<WorkspaceFile | null> {
  const file = await db.prepare("SELECT * FROM files WHERE id = ? AND user_id = ?").bind(fileId, userId).first<WorkspaceFile>();
  if (!file) return null;
  await db.prepare("DELETE FROM files WHERE id = ? AND user_id = ?").bind(fileId, userId).run();
  return file;
}
