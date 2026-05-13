import type { Env, SearchResult } from "../types";
import { LlmClient } from "../services/llm";
import { SearchClient } from "../services/search";

export interface ResearchReport {
  plan: string[];
  searches: Array<{ query: string; results: SearchResult[] }>;
  thoughts: ThoughtBranch[];
  winningThought: ThoughtBranch | null;
  report: string;
}

export interface ThoughtBranch {
  title: string;
  hypothesis: string;
  evidenceNeeded: string[];
  risks: string[];
  score: number;
  rationale: string;
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
  const thoughts = await runTreeOfThoughts(llm, topic, evidence);
  const winningThought = thoughts.length ? thoughts.reduce((best, item) => (item.score > best.score ? item : best), thoughts[0]) : null;
  const thoughtText = thoughts
    .map((item, index) => `${index + 1}. ${item.title} (${item.score}/10)\n假设：${item.hypothesis}\n证据需求：${item.evidenceNeeded.join("；")}\n风险：${item.risks.join("；")}\n评分理由：${item.rationale}`)
    .join("\n\n");
  const report = await llm.generateText(
    "你是一个多子代理研究协调者。基于搜索证据和 Tree of Thoughts 候选路径生成结构化中文报告，包含：结论摘要、最佳思路、关键发现、分歧/不确定性、建议下一步、引用链接。",
    [{ role: "user", content: `主题：${topic}\n\n搜索证据：\n${evidence}\n\nTree of Thoughts 候选路径：\n${thoughtText}\n\n最佳路径：${winningThought?.title ?? "无"}` }],
    0.3
  );
  return { plan: queries, searches, thoughts, winningThought, report };
}

async function runTreeOfThoughts(llm: LlmClient, topic: string, evidence: string): Promise<ThoughtBranch[]> {
  const result = await llm.json<{ thoughts: ThoughtBranch[] }>(
    `你是 Tree of Thoughts 推理器。为研究主题生成 3 条互相有差异的推理路径。
每条路径必须包含 title, hypothesis, evidenceNeeded, risks, score, rationale。
score 是 1-10 数字，表示该路径对回答主题的解释力、可验证性和行动价值。`,
    [{ role: "user", content: `主题：${topic}\n\n证据：${evidence.slice(0, 9000)}` }],
    { thoughts: fallbackThoughts(topic) }
  );
  return normalizeThoughts(result.thoughts, topic);
}

function normalizeThoughts(thoughts: ThoughtBranch[] | undefined, topic: string): ThoughtBranch[] {
  const source = thoughts?.length ? thoughts : fallbackThoughts(topic);
  return source.slice(0, 3).map((item, index) => ({
    title: item.title || `候选思路 ${index + 1}`,
    hypothesis: item.hypothesis || "从现有证据出发形成可验证假设。",
    evidenceNeeded: Array.isArray(item.evidenceNeeded) && item.evidenceNeeded.length ? item.evidenceNeeded : ["官方文档", "价格与限制", "实现案例"],
    risks: Array.isArray(item.risks) && item.risks.length ? item.risks : ["证据不足", "样本偏差"],
    score: clampScore(item.score),
    rationale: item.rationale || "该路径覆盖问题核心，但需要结合搜索证据验证。"
  }));
}

function fallbackThoughts(topic: string): ThoughtBranch[] {
  const clean = cleanTopic(topic);
  return [
    {
      title: "工程可行性路径",
      hypothesis: `${clean} 的价值主要取决于部署复杂度、运行时限制和与现有 Worker/D1 的集成顺滑度。`,
      evidenceNeeded: ["官方文档", "部署教程", "运行时限制"],
      risks: ["忽略成本和扩展性", "过度依赖单一平台"],
      score: 8,
      rationale: "最贴近实现落地，适合工程笔试。"
    },
    {
      title: "产品体验路径",
      hypothesis: `${clean} 的优势需要通过用户工作流、延迟和召回质量体现，而不只是技术选型。`,
      evidenceNeeded: ["用户场景", "延迟数据", "召回效果样例"],
      risks: ["定性判断偏多", "缺少量化评估"],
      score: 7,
      rationale: "能解释产品价值，但需要更多实验数据。"
    },
    {
      title: "风险与替代方案路径",
      hypothesis: `${clean} 需要和 Qdrant、Pinecone 等替代方案比较，才能判断长期风险。`,
      evidenceNeeded: ["定价", "迁移成本", "元数据过滤能力"],
      risks: ["比较维度过宽", "忽略当前项目约束"],
      score: 7,
      rationale: "有助于说明 tradeoff，适合作为报告补充。"
    }
  ];
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 6;
  return Math.max(1, Math.min(10, Math.round(value)));
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
    .replace(/^(用\s*)?(Tree of Thoughts|TOT|思维树|推理树)\s*/i, "")
    .replace(/^(深度研究|研究一下|调研|分析报告|research|deep dive)\s*[:：-]?\s*/i, "")
    .replace(/^(用\s*)?(Tree of Thoughts|TOT|思维树|推理树)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
