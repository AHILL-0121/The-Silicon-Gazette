import type { SearchContext, SearchResult, SearchTopicBlock } from "./types";

const TAVILY_BASE = "https://api.tavily.com";

/**
 * Tavily only applies `days` to `topic: "news"`; a general search ignores it
 * and returns evergreen section pages whose cached text barely changes, so
 * the same stories came back day after day. The open-source block stays on
 * general search: the repo watch needs GitHub pages, which news search rarely
 * returns, and an edition with fewer than 3 repos is rejected.
 */
const TOPIC_QUERIES: Array<{ topic: "AI" | "TECH" | "OPEN SOURCE"; query: string; searchTopic: "news" | "general" }> = [
  { topic: "AI", query: "top AI and machine learning news today", searchTopic: "news" },
  { topic: "TECH", query: "top tech startup and software news today", searchTopic: "news" },
  { topic: "OPEN SOURCE", query: "trending open source GitHub repositories today", searchTopic: "general" }
];

/** Path segments that mark a listing page rather than an article. */
const LISTING_SEGMENTS = new Set([
  "category", "categories", "tag", "tags", "topic", "topics", "section", "sections", "author", "authors"
]);

/**
 * True for a site's homepage or section page (reuters.com/technology,
 * techcrunch.com/category/ai). Their snippets are stale snapshots, not today's
 * news. Article slugs have several words, so a single short segment counts
 * as a section.
 */
export function isListingPage(url: string): boolean {
  let segments: string[];
  try {
    segments = new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return true;
  }
  if (segments.length === 0) return true;
  if (segments.some((segment) => LISTING_SEGMENTS.has(segment.toLowerCase()))) return true;
  return segments.length === 1 && segments[0].split("-").length < 5;
}

/**
 * A Tavily error response. 401/403 (bad key) and 432/433 (plan or pay-as-you-go
 * limit reached) won't clear on retry, so they are marked permanent.
 */
export class TavilyError extends Error {
  readonly permanent: boolean;

  constructor(readonly status: number, body: string) {
    super(`Tavily ${status}: ${body}`);
    this.name = "TavilyError";
    this.permanent = [401, 403, 432, 433].includes(status);
  }

  /** Short reason that is safe to show to API callers. */
  get publicReason(): string {
    if (this.status === 432 || this.status === 433) return "news search quota exhausted";
    if (this.status === 401 || this.status === 403) return "news search API key rejected";
    return `news search failed (HTTP ${this.status})`;
  }
}

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
        throw new TavilyError(response.status, body);
      }
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (error instanceof TavilyError && error.permanent) break;
      if (attempt < retries) {
        await wait(350 * (attempt + 1));
      }
    }
  }

  throw lastError;
}

async function searchTopic(query: string, searchTopic: "news" | "general"): Promise<SearchResult[]> {
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
        topic: searchTopic,
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
        days: 1
      })
    },
    1
  );

  const payload = (await response.json()) as { results?: SearchResult[] };
  const results = payload.results ?? [];
  // GitHub listing pages (/trending, /topics/...) are how the repo watch finds
  // repos, so the listing filter only applies to news results.
  return searchTopic === "news" ? results.filter((result) => !isListingPage(result.url)) : results;
}

export function serializeSearchContext(blocks: SearchTopicBlock[]): string {
  return blocks
    .map(({ topic, results }) => {
      const lines = results.map((item) => {
        const snippet = item.content?.slice(0, 300) ?? "";
        const published = item.published_date ? `\n  Published: ${item.published_date}` : "";
        return `- ${item.title}\n  URL: ${item.url}${published}\n  Snippet: ${snippet}`;
      });
      return `=== ${topic} ===\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

export async function fetchNewsContext(): Promise<SearchContext> {
  const blocks = await Promise.all(
    TOPIC_QUERIES.map(async ({ topic, query, searchTopic: kind }) => {
      const results = await searchTopic(query, kind);
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