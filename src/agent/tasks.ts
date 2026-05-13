import type { Env, Task } from "../types";
import { uid } from "../services/db";

export type TaskAction =
  | { type: "none" }
  | { type: "create"; title: string; requirements?: string[]; due_date?: string | null }
  | { type: "list" }
  | { type: "update"; match: string; title?: string; status?: Task["status"]; due_date?: string | null; requirements?: string[] }
  | { type: "delete"; match: string }
  | { type: "add_requirement"; match: string; body: string };

export function detectTaskAction(message: string): TaskAction {
  const text = message.trim();
  const lower = text.toLowerCase();
  if (/任务|todo|待办|需求/.test(text) && /(列出|查看|有哪些|list|show)/i.test(text)) return { type: "list" };
  if (/(新增|添加|创建|加一个|记一个|帮我记|create|add)/i.test(text) && /任务|todo|待办/.test(text)) {
    return { type: "create", title: extractNewTaskTitle(text), requirements: extractRequirements(text) };
  }
  if (/(完成|done|关闭|标记)/i.test(text) && /任务|todo|待办/.test(text)) return { type: "update", match: stripTaskWords(text), status: "done" };
  if (/(删除|移除|取消|delete|remove)/i.test(text) && /任务|todo|待办/.test(text)) return { type: "delete", match: stripTaskWords(text) };
  if (/(需求|要求|requirement)/i.test(text) && /(补充|新增|添加|加上|add)/i.test(text)) {
    const [match, body] = text.split(/[:：]/);
    return { type: "add_requirement", match: stripTaskWords(match || text), body: body?.trim() || text };
  }
  if (lower.startsWith("/task ")) return { type: "create", title: text.slice(6).trim() };
  return { type: "none" };
}

export async function applyTaskAction(env: Env, userId: string, action: TaskAction) {
  switch (action.type) {
    case "create": {
      const id = uid("task");
      await env.DB.prepare("INSERT INTO tasks (id, user_id, title, due_date) VALUES (?, ?, ?, ?)")
        .bind(id, userId, cleanTitle(action.title), action.due_date ?? null)
        .run();
      for (const req of action.requirements ?? []) {
        if (req.trim()) await env.DB.prepare("INSERT INTO task_requirements (id, task_id, body) VALUES (?, ?, ?)").bind(uid("req"), id, req.trim()).run();
      }
      return `已创建任务：${cleanTitle(action.title)}`;
    }
    case "list":
      return "已读取你的任务列表。";
    case "update": {
      const task = await findTask(env, userId, action.match);
      if (!task) return `我没找到匹配“${action.match}”的任务。`;
      await env.DB.prepare("UPDATE tasks SET title = ?, status = ?, due_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?")
        .bind(action.title ?? task.title, action.status ?? task.status, action.due_date ?? task.due_date, task.id, userId)
        .run();
      for (const req of action.requirements ?? []) {
        if (req.trim()) await env.DB.prepare("INSERT INTO task_requirements (id, task_id, body) VALUES (?, ?, ?)").bind(uid("req"), task.id, req.trim()).run();
      }
      return `已更新任务：${action.title ?? task.title}`;
    }
    case "delete": {
      const task = await findTask(env, userId, action.match);
      if (!task) return `我没找到匹配“${action.match}”的任务。`;
      await env.DB.prepare("UPDATE tasks SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?").bind(task.id, userId).run();
      return `已归档任务：${task.title}`;
    }
    case "add_requirement": {
      const task = await findTask(env, userId, action.match);
      if (!task) return `我没找到匹配“${action.match}”的任务。`;
      await env.DB.prepare("INSERT INTO task_requirements (id, task_id, body) VALUES (?, ?, ?)").bind(uid("req"), task.id, action.body).run();
      await env.DB.prepare("UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(task.id).run();
      return `已为“${task.title}”补充需求。`;
    }
    default:
      return "";
  }
}

async function findTask(env: Env, userId: string, query: string): Promise<Task | null> {
  const tasks = (await env.DB.prepare("SELECT * FROM tasks WHERE user_id = ? AND status != 'archived' ORDER BY updated_at DESC").bind(userId).all<Task>()).results;
  const q = cleanTitle(query).toLowerCase();
  return tasks.find((task) => task.title.toLowerCase().includes(q) || q.includes(task.title.toLowerCase())) ?? tasks[0] ?? null;
}

function stripTaskWords(text: string) {
  return text
    .replace(/(新增|添加|创建|加一个|记一个|帮我记|任务|待办|todo|删除|移除|取消|完成|标记|为|把|请|帮我|需求|要求)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTitle(title: string) {
  return title.replace(/[。.!！,，、;；:]$/g, "").trim() || "未命名任务";
}

function extractRequirements(text: string) {
  const reqPart = text.match(/(?:需求|要求|细节|requirements?)[:：](.+)$/i)?.[1];
  if (!reqPart) return [];
  return reqPart.split(/[;；\n]/).map((item) => item.trim()).filter(Boolean);
}

function extractNewTaskTitle(text: string) {
  const matched = text.match(/(?:新增|添加|创建|加一个|记一个|帮我记)\s*(?:任务|待办|todo)?\s*[:：]?\s*(.+)$/i)?.[1] ?? text;
  return matched
    .replace(/(?:需求|要求|细节|requirements?)[:：].+$/i, "")
    .replace(/^(任务|待办|todo)\s*[:：]?/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
