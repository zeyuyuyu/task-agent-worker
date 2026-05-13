import type { Env, SearchResult } from "../types";
import { LlmClient } from "../services/llm";
import { SearchClient } from "../services/search";

export interface ResearchReport {
  plan: string[];
  searches: Array<{ query: string; results: SearchResult[] }>;
  report: string;
}

export function isResearchRequest(message: string) {
  return /(深度研究|研究一下|调研|分析报告|竞品分析|research|deep dive|全面分析)/i.test(message);
}

export async function runResearch(env: Env, topic: string): Promise<ResearchReport> {
  const llm = new LlmClient(env);
  const plan = await llm.json<{ queries: string[] }>(
    "你是研究规划代理。把复杂主题拆成 3-5 个适合搜索引擎的短查询。优先输出英文关键词查询，不要包含“深度研究/调研/报告”等泛化词。",
    [{ role: "user", content: topic }],
    { queries: defaultQueries(topic) }
  );
  const queries = normalizeQueries(topic, plan.queries);
  const search = new SearchClient(env);
  const searches = [];
  for (const query of queries) {
    searches.push({ query, results: await search.search(query, 5) });
  }
  const evidence = searches
    .map((s) => `## ${s.query}\n${s.results.map((r, i) => `${i + 1}. ${r.title}\n${r.snippet}\n${r.link}`).join("\n")}`)
    .join("\n\n");
  const report = await llm.generateText(
    "你是一个多子代理研究协调者。基于搜索证据生成结构化中文报告，包含：结论摘要、关键发现、分歧/不确定性、建议下一步、引用链接。",
    [{ role: "user", content: `主题：${topic}\n\n搜索证据：\n${evidence}` }],
    0.3
  );
  return { plan: queries, searches, report };
}

function normalizeQueries(topic: string, queries?: string[]) {
  const clean = cleanTopic(topic);
  if (/cloudflare|vectorize/i.test(clean)) return defaultQueries(clean);
  const candidates = (queries?.length ? queries : defaultQueries(topic))
    .map((query) => cleanTopic(query))
    .filter((query) => query.length > 3 && !/^(深度研究|研究|调研|分析报告)$/i.test(query));
  const useful = candidates.filter((query) => query !== clean || /Cloudflare|Vectorize|RAG|agent|AI/i.test(query));
  const merged = [...useful, ...defaultQueries(clean)];
  return [...new Set(merged)].slice(0, 5);
}

function defaultQueries(topic: string) {
  const clean = cleanTopic(topic);
  if (/cloudflare|vectorize/i.test(clean)) {
    return [
      `site:developers.cloudflare.com Vectorize RAG Cloudflare`,
      `Cloudflare Vectorize official documentation metadata filtering`,
      `Cloudflare Vectorize RAG applications advantages disadvantages`,
      `Cloudflare Vectorize pricing limits dimensions cosine`,
      `Cloudflare Vectorize vs Qdrant RAG`
    ];
  }
  return [
    `${clean} official documentation`,
    `${clean} advantages disadvantages`,
    `${clean} RAG implementation best practices`,
    `${clean} pricing limits metadata filtering`,
    `${clean} comparison Qdrant Vectorize`
  ];
}

function cleanTopic(value: string) {
  return value
    .replace(/^(深度研究|研究一下|调研|分析报告|research|deep dive)\s*[:：-]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
