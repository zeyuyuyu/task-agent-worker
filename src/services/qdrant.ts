import type { Env, RetrievedContext } from "../types";
import { cosine } from "./llm";

interface PointPayload {
  user_id: string;
  source: "file" | "memory";
  title: string;
  content: string;
  file_id?: string;
}

export class VectorStore {
  private readonly collection: string;

  constructor(private readonly env: Env) {
    this.collection = env.QDRANT_COLLECTION || "task_agent_chunks";
  }

  get enabled() {
    return Boolean(this.env.VECTORIZE || (this.env.QDRANT_URL && this.env.QDRANT_API_KEY));
  }

  async ensureCollection() {
    if (!this.enabled) return;
    const url = `${this.env.QDRANT_URL}/collections/${this.collection}`;
    const exists = await fetch(url, { headers: this.headers() });
    if (exists.ok) return;
    await fetch(url, {
      method: "PUT",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({ vectors: { size: 768, distance: "Cosine" } })
    });
  }

  async upsert(points: Array<{ id: string; vector: number[]; payload: PointPayload }>) {
    if (this.env.VECTORIZE && points.length) {
      await this.env.VECTORIZE.upsert(
        points.map((point) => ({
          id: point.id,
          values: point.vector,
          metadata: { ...point.payload }
        }))
      );
      return;
    }
    if (!this.enabled || !points.length) return;
    await this.ensureCollection();
    await fetch(`${this.env.QDRANT_URL}/collections/${this.collection}/points?wait=true`, {
      method: "PUT",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({ points })
    });
  }

  async deleteByFile(fileId: string, ids?: string[]) {
    if (this.env.VECTORIZE) {
      if (ids?.length) await this.env.VECTORIZE.deleteByIds(ids);
      return;
    }
    if (!this.enabled) return;
    await fetch(`${this.env.QDRANT_URL}/collections/${this.collection}/points/delete?wait=true`, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({
        filter: { must: [{ key: "file_id", match: { value: fileId } }] }
      })
    });
  }

  async search(db: D1Database, userId: string, vector: number[], limit = 6): Promise<RetrievedContext[]> {
    if (this.env.VECTORIZE) {
      const data = await this.env.VECTORIZE.query(vector, {
        topK: limit,
        returnMetadata: true,
        filter: { user_id: userId }
      });
      return data.matches.map((item) => {
        const metadata = item.metadata as unknown as PointPayload | undefined;
        return {
          id: item.id,
          score: item.score,
          source: metadata?.source ?? "file",
          title: metadata?.title ?? "Untitled",
          content: metadata?.content ?? ""
        };
      });
    }
    if (this.enabled) {
      const res = await fetch(`${this.env.QDRANT_URL}/collections/${this.collection}/points/search`, {
        method: "POST",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({
          vector,
          limit,
          with_payload: true,
          filter: { must: [{ key: "user_id", match: { value: userId } }] }
        })
      });
      if (res.ok) {
        const data = (await res.json()) as { result?: Array<{ id: string; score: number; payload?: PointPayload }> };
        return (data.result ?? []).map((item) => ({
          id: String(item.id),
          score: item.score,
          source: item.payload?.source ?? "file",
          title: item.payload?.title ?? "Untitled",
          content: item.payload?.content ?? ""
        }));
      }
    }
    return this.localD1Search(db, userId, vector, limit);
  }

  private async localD1Search(db: D1Database, userId: string, vector: number[], limit: number): Promise<RetrievedContext[]> {
    const chunks = (await db
      .prepare(`SELECT c.id, c.content, c.vector_json, f.name AS title FROM chunks c JOIN files f ON f.id = c.file_id WHERE c.user_id = ?`)
      .bind(userId)
      .all<{ id: string; content: string; vector_json: string | null; title: string }>()).results;
    const memories = (await db
      .prepare("SELECT id, content, vector_json FROM memories WHERE user_id = ? ORDER BY created_at DESC LIMIT 80")
      .bind(userId)
      .all<{ id: string; content: string; vector_json: string | null }>()).results;
    return [
      ...chunks.map((row) => ({ ...row, source: "file" as const, title: row.title })),
      ...memories.map((row) => ({ ...row, source: "memory" as const, title: "conversation memory" }))
    ]
      .filter((row) => row.vector_json)
      .map((row) => ({
        id: row.id,
        source: row.source,
        title: row.title,
        content: row.content,
        score: cosine(JSON.parse(row.vector_json || "[]") as number[], vector)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private headers() {
    return { "api-key": this.env.QDRANT_API_KEY || "" };
  }
}
