import { unzipSync, strFromU8 } from "fflate";
import type { Env, RetrievedContext, User, WorkspaceFile } from "../types";
import { uid } from "./db";
import { LlmClient } from "./llm";
import { VectorStore } from "./qdrant";

export function chunkText(text: string, maxChars = 900, overlap = 120): string[] {
  const normalized = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  for (let start = 0; start < normalized.length; start += maxChars - overlap) {
    chunks.push(normalized.slice(start, start + maxChars));
  }
  return chunks;
}

export async function ingestFile(env: Env, user: User, file: File): Promise<WorkspaceFile> {
  const bytes = await file.arrayBuffer();
  const llm = new LlmClient(env);
  const text = await extractText(llm, bytes, file.type || guessMime(file.name), file.name);
  const summary = await llm.generateText("用一句中文概括这个上传文件，最多 60 字。", [{ role: "user", content: text.slice(0, 6000) }], 0.2);
  const fileId = uid("file");
  const storageKey = `${user.id}/${fileId}/${file.name}`;

  if (env.FILE_BUCKET) await env.FILE_BUCKET.put(storageKey, bytes, { httpMetadata: { contentType: file.type } });
  await env.DB.prepare("INSERT INTO files (id, user_id, name, mime_type, size, summary, storage_key) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(fileId, user.id, file.name, file.type || guessMime(file.name), file.size, summary, env.FILE_BUCKET ? storageKey : null)
    .run();

  const store = new VectorStore(env);
  const chunks = chunkText(text);
  const points = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const id = crypto.randomUUID();
    const vector = await llm.embed(chunks[i]);
    await env.DB.prepare("INSERT INTO chunks (id, file_id, user_id, ordinal, content, vector_json) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, fileId, user.id, i, chunks[i], JSON.stringify(vector))
      .run();
    points.push({
      id,
      vector,
      payload: { user_id: user.id, source: "file" as const, title: file.name, content: chunks[i], file_id: fileId }
    });
  }
  await store.upsert(points);
  return (await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(fileId).first<WorkspaceFile>())!;
}

export async function retrieveContexts(env: Env, userId: string, query: string): Promise<RetrievedContext[]> {
  const llm = new LlmClient(env);
  const vector = await llm.embed(query);
  return new VectorStore(env).search(env.DB, userId, vector, 8);
}

export async function rememberTurn(env: Env, userId: string, userMessage: string, assistantMessage: string) {
  const content = `用户：${userMessage}\n助手：${assistantMessage.slice(0, 1200)}`;
  const llm = new LlmClient(env);
  const vector = await llm.embed(content);
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO memories (id, user_id, content, vector_json) VALUES (?, ?, ?, ?)")
    .bind(id, userId, content, JSON.stringify(vector))
    .run();
  await new VectorStore(env).upsert([{ id, vector, payload: { user_id: userId, source: "memory", title: "conversation memory", content } }]);
}

async function extractText(llm: LlmClient, bytes: ArrayBuffer, mimeType: string, fileName: string): Promise<string> {
  if (mimeType.startsWith("image/")) return llm.describeImage(bytes, mimeType, fileName);
  if (mimeType.includes("wordprocessingml") || fileName.toLowerCase().endsWith(".docx")) return extractDocx(bytes);
  if (mimeType.includes("pdf") || fileName.toLowerCase().endsWith(".pdf")) return extractPdfBestEffort(bytes);
  return new TextDecoder().decode(bytes);
}

function extractDocx(bytes: ArrayBuffer) {
  const zip = unzipSync(new Uint8Array(bytes));
  const xml = zip["word/document.xml"] ? strFromU8(zip["word/document.xml"]) : "";
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function extractPdfBestEffort(bytes: ArrayBuffer) {
  const arr = new Uint8Array(bytes);
  let raw = "";
  for (let i = 0; i < arr.length; i += 0x8000) raw += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  const literal = [...raw.matchAll(/\(([^)]{2,})\)\s*Tj/g)].map((m) => m[1]);
  const arrays = [...raw.matchAll(/\[((?:\([^)]*\)\s*)+)\]\s*TJ/g)].map((m) => [...m[1].matchAll(/\(([^)]*)\)/g)].map((x) => x[1]).join(""));
  const text = [...literal, ...arrays].join("\n").replace(/\\([()\\])/g, "$1");
  return text.trim() || "PDF 已上传，但轻量解析器未提取到可读文本。可换成可复制文本 PDF，或配置多模态模型进行 OCR。";
}

function guessMime(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}
