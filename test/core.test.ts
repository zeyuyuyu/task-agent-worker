import { describe, expect, it } from "vitest";
import { chunkText } from "../src/services/files";
import { detectTaskAction } from "../src/agent/tasks";
import { hashEmbedding, cosine } from "../src/services/llm";

describe("core helpers", () => {
  it("chunks text with overlap", () => {
    const chunks = chunkText("a".repeat(2100), 900, 100);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].length).toBe(900);
  });

  it("detects natural language task creation", () => {
    const action = detectTaskAction("新增任务：准备 AI Agent 笔试，需求：部署 Cloudflare；写 README");
    expect(action.type).toBe("create");
    if (action.type === "create") {
      expect(action.title).toContain("准备 AI Agent 笔试");
      expect(action.requirements).toHaveLength(2);
    }
    expect(detectTaskAction("我叫张三，我的邮箱是 zhangsan@example.com。叫你小米。新增任务：完成 AI Agent 笔试项目，需求：部署到 Cloudflare；写 README；支持 RAG").type).toBe("create");
  });

  it("creates stable local embeddings", () => {
    const a = hashEmbedding("Cloudflare Worker AI Agent");
    const b = hashEmbedding("Cloudflare Worker AI Agent");
    expect(cosine(a, b)).toBeGreaterThan(0.99);
  });
});
