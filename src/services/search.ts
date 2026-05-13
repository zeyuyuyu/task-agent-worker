import type { Env, SearchResult } from "../types";

export class SearchClient {
  constructor(private readonly env: Env) {}

  async search(query: string, num = 5): Promise<SearchResult[]> {
    if (!this.env.SERPER_API_KEY) {
      return this.bingRssSearch(query, num);
    }
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": this.env.SERPER_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ q: query, num })
    });
    if (!res.ok) throw new Error(`Serper search failed: ${res.status}`);
    const data = (await res.json()) as { organic?: Array<{ title?: string; link?: string; snippet?: string }> };
    return (data.organic ?? []).slice(0, num).map((item) => ({
      title: item.title || "Untitled",
      link: item.link || "",
      snippet: item.snippet || ""
    }));
  }

  private async bingRssSearch(query: string, num: number): Promise<SearchResult[]> {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&mkt=en-US&cc=US&setlang=en-US`;
    const res = await fetch(url, {
      headers: { "user-agent": "MiraTaskAgent/1.0 (+https://workers.dev)" }
    });
    if (!res.ok) {
      return [{ title: "Search temporarily unavailable", link: "", snippet: `实时搜索失败：${res.status}。查询：${query}` }];
    }
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, num);
    return items.map((match) => {
      const item = match[1];
      return {
        title: decodeXml(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "Untitled"),
        link: decodeXml(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || ""),
        snippet: decodeXml(item.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "")
      };
    });
  }
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();
}
