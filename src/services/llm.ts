import type { ChatMessage, Env } from "../types";

const DEFAULT_MODEL = "gemini-2.0-flash-lite";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIM = 768;

export class LlmClient {
  constructor(private readonly env: Env) {}

  get hasRemoteModel() {
    return Boolean(this.env.OPENAI_API_KEY || this.env.GEMINI_API_KEY);
  }

  async generateText(system: string, messages: ChatMessage[], temperature = 0.4): Promise<string> {
    if (this.env.OPENAI_API_KEY) return this.openaiText(system, messages, temperature);
    if (!this.env.GEMINI_API_KEY) return this.localAnswer(system, messages);
    const model = this.env.GEMINI_MODEL || DEFAULT_MODEL;
    const prompt = [
      { role: "user", parts: [{ text: `${system}\n\n${messages.map((m) => `${m.role}: ${m.content}`).join("\n\n")}` }] }
    ];
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: prompt,
        generationConfig: { temperature, topP: 0.9, maxOutputTokens: 4096 }
      })
    });
    if (!res.ok) return `模型调用失败：${res.status} ${await res.text()}`;
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() || "我暂时没有生成到有效回答。";
  }

  async json<T>(system: string, messages: ChatMessage[], fallback: T): Promise<T> {
    const text = await this.generateText(`${system}\n只返回 JSON，不要 Markdown 代码块。`, messages, 0.1);
    try {
      return JSON.parse(text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim()) as T;
    } catch {
      return fallback;
    }
  }

  async embed(text: string): Promise<number[]> {
    if (this.env.OPENAI_API_KEY) return this.openaiEmbedding(text);
    if (!this.env.GEMINI_API_KEY) return hashEmbedding(text);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${this.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: EMBEDDING_DIM })
    });
    if (!res.ok) return hashEmbedding(text);
    const data = (await res.json()) as { embedding?: { values?: number[] } };
    return data.embedding?.values?.length ? data.embedding.values : hashEmbedding(text);
  }

  async describeImage(bytes: ArrayBuffer, mimeType: string, fileName: string): Promise<string> {
    if (this.env.OPENAI_API_KEY) return this.openaiImageDescription(bytes, mimeType, fileName);
    if (!this.env.GEMINI_API_KEY) return `图片 ${fileName} 已上传；未配置 GEMINI_API_KEY，因此只能记录文件元数据，暂不做 OCR。`;
    const base64 = arrayBufferToBase64(bytes);
    return this.generateText("你是文件解析代理。提取图片里的文字、表格、关键对象和可用于检索的事实，中文输出。", [
      {
        role: "user",
        content: JSON.stringify({
          instruction: `请解析图片 ${fileName}`,
          inlineData: { mimeType, data: base64.slice(0, 80) + "..." }
        })
      }
    ]);
  }

  streamFromText(text: string): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const parts = text.match(/.{1,18}(\s|$)|.{1,18}/g) ?? [text];
    return new ReadableStream({
      async start(controller) {
        for (const part of parts) {
          controller.enqueue(encoder.encode(part));
          await new Promise((resolve) => setTimeout(resolve, 12));
        }
        controller.close();
      }
    });
  }

  private localAnswer(system: string, messages: ChatMessage[]) {
    const last = messages[messages.length - 1]?.content ?? "";
    if (system.includes("研究")) return `已进入研究模式。当前未配置 OPENAI_API_KEY 或 GEMINI_API_KEY，我会基于搜索结果和本地规则整理：\n\n${last}`;
    return `我已收到：“${last}”。当前未配置 OPENAI_API_KEY 或 GEMINI_API_KEY，已使用本地规则完成可确定的操作；配置模型 key 后会启用完整自然语言生成。`;
  }

  private async openaiText(system: string, messages: ChatMessage[], temperature: number): Promise<string> {
    const model = this.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: "system", content: system },
          ...messages.map((message) => ({ role: message.role, content: message.content }))
        ]
      })
    });
    if (!res.ok) return `OpenAI 调用失败：${res.status} ${await res.text()}`;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || "我暂时没有生成到有效回答。";
  }

  private async openaiEmbedding(text: string): Promise<number[]> {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.env.OPENAI_EMBEDDING_MODEL || DEFAULT_OPENAI_EMBEDDING_MODEL,
        input: text,
        dimensions: EMBEDDING_DIM
      })
    });
    if (!res.ok) return hashEmbedding(text);
    const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    return data.data?.[0]?.embedding?.length ? data.data[0].embedding : hashEmbedding(text);
  }

  private async openaiImageDescription(bytes: ArrayBuffer, mimeType: string, fileName: string): Promise<string> {
    const base64 = arrayBufferToBase64(bytes);
    return this.openaiText(
      "你是文件解析代理。提取图片里的文字、表格、关键对象和可用于检索的事实，中文输出。",
      [
        {
          role: "user",
          content: [
            { type: "text", text: `请解析图片 ${fileName}` },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } }
          ] as unknown as string
        }
      ],
      0.2
    );
  }
}

export function cosine(a: number[], b: number[]) {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return dot / (Math.sqrt(aa) * Math.sqrt(bb) || 1);
}

export function hashEmbedding(text: string): number[] {
  const vector = new Array(EMBEDDING_DIM).fill(0);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const idx = (code * 31 + i * 17) % EMBEDDING_DIM;
    vector[idx] += ((code % 23) - 11) / 11;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
