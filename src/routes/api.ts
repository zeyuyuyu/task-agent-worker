import { Hono } from "hono";
import type { Env } from "../types";
import { ensureUser, listFiles, listTasks, recentConversation, saveConversation, updateUser, deleteFileRows } from "../services/db";
import { LlmClient } from "../services/llm";
import { ingestFile, rememberTurn, retrieveContexts } from "../services/files";
import { VectorStore } from "../services/qdrant";
import { applyTaskAction, detectTaskAction } from "../agent/tasks";
import { isResearchRequest, runResearch } from "../agent/research";
import { systemPrompt } from "../agent/prompts";

export const api = new Hono<{ Bindings: Env }>();

api.use("*", async (c, next) => {
  const sessionId = getSessionId(c.req.raw);
  c.header("x-session-id", sessionId);
  await next();
});

api.get("/me", async (c) => {
  const user = await ensureUser(c.env.DB, getSessionId(c.req.raw));
  return c.json({ user, tasks: await listTasks(c.env.DB, user.id), files: await listFiles(c.env.DB, user.id) });
});

api.post("/me", async (c) => {
  const user = await ensureUser(c.env.DB, getSessionId(c.req.raw));
  const body = (await c.req.json()) as { name?: string; email?: string; ai_nickname?: string };
  const updated = await updateUser(c.env.DB, user.id, body);
  return c.json({ user: updated });
});

api.get("/tasks", async (c) => {
  const user = await ensureUser(c.env.DB, getSessionId(c.req.raw));
  return c.json({ tasks: await listTasks(c.env.DB, user.id) });
});

api.get("/files", async (c) => {
  const user = await ensureUser(c.env.DB, getSessionId(c.req.raw));
  return c.json({ files: await listFiles(c.env.DB, user.id) });
});

api.post("/files", async (c) => {
  const user = await ensureUser(c.env.DB, getSessionId(c.req.raw));
  const form = await c.req.formData();
  const uploaded = form.get("file");
  if (!isUploadedFile(uploaded)) return c.json({ error: "Missing file" }, 400);
  const file = await ingestFile(c.env, user, uploaded);
  return c.json({ file });
});

api.delete("/files/:id", async (c) => {
  const user = await ensureUser(c.env.DB, getSessionId(c.req.raw));
  const file = await deleteFileRows(c.env.DB, user.id, c.req.param("id"));
  if (!file) return c.json({ error: "File not found" }, 404);
  if (file.storage_key && c.env.FILE_BUCKET) await c.env.FILE_BUCKET.delete(file.storage_key);
  await new VectorStore(c.env).deleteByFile(file.id);
  return c.json({ ok: true });
});

api.post("/research", async (c) => {
  const body = (await c.req.json()) as { topic?: string };
  if (!body.topic) return c.json({ error: "Missing topic" }, 400);
  return c.json(await runResearch(c.env, body.topic));
});

api.post("/chat", async (c) => {
  const body = (await c.req.json()) as { message?: string };
  const message = body.message?.trim();
  if (!message) return c.text("Missing message", 400);

  const user = await ensureUser(c.env.DB, getSessionId(c.req.raw));
  await saveConversation(c.env.DB, user.id, "user", message);

  const userPatch = extractUserPatch(message);
  const updatedUser = Object.keys(userPatch).length ? await updateUser(c.env.DB, user.id, userPatch) : user;

  let toolNote = "";
  const taskAction = detectTaskAction(message);
  if (taskAction.type !== "none") toolNote += await applyTaskAction(c.env, updatedUser.id, taskAction);

  if (isResearchRequest(message)) {
    const research = await runResearch(c.env, message);
    toolNote += `\n研究子代理计划：${research.plan.join(" | ")}\n${research.report}`;
  }

  const [tasks, files, contexts, history] = await Promise.all([
    listTasks(c.env.DB, updatedUser.id),
    listFiles(c.env.DB, updatedUser.id),
    retrieveContexts(c.env, updatedUser.id, message),
    recentConversation(c.env.DB, updatedUser.id, 10)
  ]);
  const llm = new LlmClient(c.env);
  const system = systemPrompt(updatedUser, tasks, contexts, files, toolNote);
  const answer = await llm.generateText(system, [...history, { role: "user", content: message }], 0.45);
  await saveConversation(c.env.DB, updatedUser.id, "assistant", answer);
  await rememberTurn(c.env, updatedUser.id, message, answer);

  return new Response(llm.streamFromText(answer), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache",
      "x-accel-buffering": "no"
    }
  });
});

function getSessionId(req: Request) {
  const header = req.headers.get("x-session-id");
  if (header) return header;
  const cookie = req.headers.get("cookie") || "";
  const existing = cookie.match(/(?:^|;\s*)task_agent_session=([^;]+)/)?.[1];
  return existing || crypto.randomUUID();
}

function extractUserPatch(message: string) {
  const patch: { name?: string; email?: string; ai_nickname?: string } = {};
  const email = message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email) patch.email = email;
  const name = message.match(/(?:我叫|我的名字是|名字叫)\s*([\u4e00-\u9fa5A-Za-z0-9_-]{1,24})/)?.[1];
  if (name) patch.name = name;
  const nick = message.match(/(?:叫你|你的昵称(?:改成|叫)|AI(?:昵称|名字)(?:改成|叫))\s*([\u4e00-\u9fa5A-Za-z0-9_-]{1,24})/)?.[1];
  if (nick) patch.ai_nickname = nick;
  return patch;
}

function isUploadedFile(value: unknown): value is File {
  return Boolean(
    value &&
      typeof value === "object" &&
      "arrayBuffer" in value &&
      "name" in value &&
      "type" in value &&
      "size" in value
  );
}
