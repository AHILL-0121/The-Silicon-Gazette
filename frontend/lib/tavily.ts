import type { SearchContext, SearchResult, SearchTopicBlock } from "./types";

const TAVILY_BASE = "https://api.tavily.com";

const TOPIC_QUERIES: Array<{ topic: "AI" | "TECH" | "OPEN SOURCE"; query: string }> = [
  { topic: "AI", query: "top AI and machine learning news today" },
  { topic: "TECH", query: "top tech startup and software news today" },
  { topic: "OPEN SOURCE", query: "trending open source GitHub repositories today" }
];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  retries: number
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Tavily ${response.status}: ${body}`);
      }
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt < retries) {
        await wait(350 * (attempt + 1));
      }
    }
  }

  throw lastError;
}

async function searchTopic(query: string): Promise<SearchResult[]> {
  if (!process.env.TAVILY_API_KEY) {
    throw new Error("TAVILY_API_KEY is not configured");
  }

  const response = await fetchWithRetry(
    `${TAVILY_BASE}/search`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.TAVILY_API_KEY}`
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
        days: 1
      })
    },
    1
  );

  const payload = (await response.json()) as { results?: SearchResult[] };
  return payload.results ?? [];
}

export function serializeSearchContext(blocks: SearchTopicBlock[]): string {
  return blocks
    .map(({ topic, results }) => {
      const lines = results.map((item) => {
        const snippet = item.content?.slice(0, 300) ?? "";
        return `- ${item.title}\n  URL: ${item.url}\n  Snippet: ${snippet}`;
      });
      return `=== ${topic} ===\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

export async function fetchNewsContext(): Promise<SearchContext> {
  const blocks = await Promise.all(
    TOPIC_QUERIES.map(async ({ topic, query }) => {
      const results = await searchTopic(query);
      return {
        topic,
        query,
        results
      } satisfies SearchTopicBlock;
    })
  );

  return {
    blocks,
    serialized: serializeSearchContext(blocks)
  };
}