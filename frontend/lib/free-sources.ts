import { MAX_RESULT_AGE_DAYS, cleanSnippet, hostOf, isAggregatorUrl, isStale } from "./evidence";
import { logEvent } from "./logger";
import type { SearchResult, SearchTopicBlock } from "./types";

/**
 * Free, keyless news sources: publisher RSS/Atom feeds, Hacker News and the
 * GitHub search API. Unlike Tavily's snippets, these carry the publisher's own
 * summary (RSS), a page description (HN links) or the repository's real star
 * count and description (GitHub), so far less is left for a model to invent.
 * Everything is returned in the same SearchTopicBlock shape Tavily uses, so
 * storage, evidence cleaning and fact-checking work unchanged.
 */

const USER_AGENT = "TheSiliconGazette/1.0 (news aggregator)";
const FETCH_TIMEOUT_MS = 8_000;

/** Items kept per block. Every item is sent with each model call, so keep it tight. */
const BLOCK_LIMITS = { AI: 6, TECH: 8, "OPEN SOURCE": 5 } as const;
const MAX_PER_HOST = 2;
const MAX_PER_FEED = 4;

const FEEDS: Array<{ name: string; url: string; topic: "AI" | "TECH" }> = [
  { name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/", topic: "AI" },
  { name: "The Verge AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", topic: "AI" },
  { name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/", topic: "AI" },
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", topic: "TECH" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", topic: "TECH" },
  { name: "Wired", url: "https://www.wired.com/feed/rss", topic: "TECH" },
  { name: "GeekWire", url: "https://www.geekwire.com/feed/", topic: "TECH" },
  { name: "SiliconANGLE", url: "https://siliconangle.com/feed/", topic: "TECH" },
  { name: "The Register", url: "https://www.theregister.com/headlines.atom", topic: "TECH" },
  { name: "BleepingComputer", url: "https://www.bleepingcomputer.com/feed/", topic: "TECH" },
  { name: "Krebs on Security", url: "https://krebsonsecurity.com/feed/", topic: "TECH" }
];

async function fetchText(url: string, accept: string, timeoutMs = FETCH_TIMEOUT_MS, maxBytes = 2_000_000): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: accept },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  return text.length > maxBytes ? text.slice(0, maxBytes) : text;
}

/* -------------------------------------------------------------------------- */
/* RSS / Atom                                                                  */
/* -------------------------------------------------------------------------- */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“"
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** HTML fragment -> plain text. */
export function htmlToText(html: string): string {
  const withoutCdata = html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const withoutBlocks = withoutCdata.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  // Decode first so entity-encoded markup (&lt;p&gt;) is stripped as well.
  const decoded = decodeEntities(withoutBlocks);
  return decodeEntities(decoded.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function tagContent(block: string, tags: string[]): string | undefined {
  for (const tag of tags) {
    const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(block);
    if (match?.[1]?.trim()) return match[1];
  }
  return undefined;
}

function itemLink(block: string): string | undefined {
  const text = tagContent(block, ["link"]);
  if (text) {
    const plain = htmlToText(text);
    if (/^https?:\/\//i.test(plain)) return plain;
  }
  // Atom: <link rel="alternate" href="..."/> (rel defaults to alternate).
  for (const tag of block.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /rel=["']([^"']+)["']/i.exec(tag)?.[1] ?? "alternate";
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (href && rel === "alternate") return decodeEntities(href);
  }
  return undefined;
}

export function parseFeed(xml: string): SearchResult[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const results: SearchResult[] = [];
  for (const block of blocks) {
    const title = htmlToText(tagContent(block, ["title"]) ?? "");
    const url = itemLink(block);
    if (!title || !url) continue;
    const summary = tagContent(block, ["description", "summary", "content:encoded", "content"]) ?? "";
    const published = htmlToText(tagContent(block, ["pubDate", "published", "updated", "dc:date"]) ?? "");
    results.push({
      title,
      url,
      content: cleanSnippet(htmlToText(summary)),
      published_date: published || undefined,
      score: 0
    });
  }
  return results;
}

/** Paid placements and event ads read like news but are not. */
function isSponsored(item: SearchResult): boolean {
  return /\/(sponsored|promoted|advertorial|partner-content)(\/|-|$)/i.test(item.url) || /^(sponsored|advertorial)/i.test(item.title);
}

async function fetchFeed(feed: (typeof FEEDS)[number]): Promise<SearchResult[]> {
  const xml = await fetchText(feed.url, "application/rss+xml, application/atom+xml, application/xml, text/xml, */*");
  return parseFeed(xml)
    .filter((item) => !isStale(item.published_date) && !isAggregatorUrl(item.url) && !isSponsored(item))
    .sort((a, b) => Date.parse(b.published_date ?? "") - Date.parse(a.published_date ?? ""))
    .slice(0, MAX_PER_FEED);
}

/* -------------------------------------------------------------------------- */
/* Hacker News                                                                 */
/* -------------------------------------------------------------------------- */

/** Refuses loopback, private and non-http(s) targets: HN links are user-submitted. */
export function isPublicHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return false;
  if (host.includes(":")) return false; // IPv6 literal
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false; // IPv4 literal
  return host.includes(".");
}

/** og:description / meta description of a page: the real summary a link has. */
export function extractMetaDescription(html: string): string {
  const head = html.slice(0, 120_000);
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /(?:property|name)=["'](og:description|twitter:description|description)["']/i.exec(tag)?.[1];
    const content = /content=["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && content) return htmlToText(content);
  }
  return "";
}

interface HnHit {
  title?: string;
  url?: string;
  points?: number;
  created_at?: string;
}

async function fetchHackerNews(): Promise<SearchResult[]> {
  const since = Math.floor(Date.now() / 1000) - 2 * 86_400;
  const api = `https://hn.algolia.com/api/v1/search?tags=story&numericFilters=${encodeURIComponent(`points>150,created_at_i>${since}`)}&hitsPerPage=20`;
  const data = JSON.parse(await fetchText(api, "application/json")) as { hits?: HnHit[] };
  const hits = (data.hits ?? [])
    .filter((hit) => hit.title && hit.url && isPublicHttpUrl(hit.url) && !isAggregatorUrl(hit.url))
    .filter((hit) => !/^(Ask|Show) HN/i.test(hit.title ?? ""))
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
    .slice(0, 8);

  // Link pages carry their own summary in a meta tag; fetch them in parallel, briefly.
  const results = await Promise.all(
    hits.map(async (hit): Promise<SearchResult | null> => {
      let description = "";
      try {
        description = extractMetaDescription(await fetchText(hit.url as string, "text/html", 4_000, 150_000));
      } catch {
        // No description: the item stays title-only and is labelled Evidence: low.
      }
      return {
        title: hit.title as string,
        url: hit.url as string,
        content: cleanSnippet(description),
        published_date: hit.created_at,
        score: hit.points ?? 0
      };
    })
  );
  return results.filter((result): result is SearchResult => result !== null);
}

/* -------------------------------------------------------------------------- */
/* GitHub                                                                      */
/* -------------------------------------------------------------------------- */

interface GithubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  created_at: string;
  pushed_at: string;
}

export function formatStars(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

/** Repositories created in the last week, most starred first: what is breaking out. */
async function fetchGithubRepos(): Promise<SearchResult[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const api = `https://api.github.com/search/repositories?q=${encodeURIComponent(`created:>${since}`)}&sort=stars&order=desc&per_page=20`;
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(api, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
  const data = (await response.json()) as { items?: GithubRepo[] };

  return (data.items ?? [])
    .filter((repo) => repo.description && repo.description.trim().length >= 10)
    .map((repo): SearchResult => {
      const description = repo.description!.trim().replace(/\s+/g, " ");
      const language = repo.language ?? "Unknown";
      return {
        title: repo.full_name,
        url: repo.html_url,
        // Facts first: the snippet is cut to a fixed length, and a long description must not push
        // the star count out of the text the fact-check reads.
        content: `Stars: ${repo.stargazers_count.toLocaleString("en-US")}. Language: ${language}. ${description}`,
        published_date: repo.created_at,
        score: repo.stargazers_count,
        repo: {
          name: repo.full_name,
          stars: repo.stargazers_count,
          language,
          description: description.slice(0, 200)
        }
      };
    });
}

/* -------------------------------------------------------------------------- */
/* Combined                                                                    */
/* -------------------------------------------------------------------------- */

/** Newest first, at most MAX_PER_HOST per site so one publisher cannot fill a block. */
function pick(results: SearchResult[], limit: number): SearchResult[] {
  const perHost = new Map<string, number>();
  const seen = new Set<string>();
  const picked: SearchResult[] = [];
  const sorted = [...results].sort((a, b) => Date.parse(b.published_date ?? "") - Date.parse(a.published_date ?? ""));
  for (const result of sorted) {
    if (picked.length >= limit) break;
    const host = hostOf(result.url);
    if (seen.has(result.url) || (perHost.get(host) ?? 0) >= MAX_PER_HOST) continue;
    seen.add(result.url);
    perHost.set(host, (perHost.get(host) ?? 0) + 1);
    picked.push(result);
  }
  return picked;
}

/**
 * Fetches every free source. A source that fails is skipped and logged; the
 * call only throws when nothing at all came back.
 */
export async function fetchFreeContext(): Promise<SearchTopicBlock[]> {
  const feedJobs = FEEDS.map(async (feed) => ({ feed, items: await fetchFeed(feed) }));
  const [feedResults, hn, github] = await Promise.all([
    Promise.allSettled(feedJobs),
    Promise.allSettled([fetchHackerNews()]).then((r) => r[0]),
    Promise.allSettled([fetchGithubRepos()]).then((r) => r[0])
  ]);

  const byTopic: Record<"AI" | "TECH", SearchResult[]> = { AI: [], TECH: [] };
  feedResults.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") byTopic[outcome.value.feed.topic].push(...outcome.value.items);
    else logEvent("warn", "free_sources.feed_failed", { feed: FEEDS[index].name, error: String(outcome.reason).slice(0, 160) });
  });
  if (hn.status === "fulfilled") byTopic.TECH.push(...hn.value);
  else logEvent("warn", "free_sources.hn_failed", { error: String(hn.reason).slice(0, 160) });
  const repos = github.status === "fulfilled" ? github.value : [];
  if (github.status === "rejected") logEvent("warn", "free_sources.github_failed", { error: String(github.reason).slice(0, 160) });

  const blocks: SearchTopicBlock[] = [
    { topic: "AI", query: "rss: AI feeds", results: pick(byTopic.AI, BLOCK_LIMITS.AI) },
    { topic: "TECH", query: "rss + hacker news: tech feeds", results: pick(byTopic.TECH, BLOCK_LIMITS.TECH) },
    { topic: "OPEN SOURCE", query: "github: new repositories by stars (7 days)", results: repos.slice(0, 8) }
  ];
  if (blocks.every((block) => block.results.length === 0)) {
    throw new Error("Free news sources returned nothing");
  }
  logEvent("info", "free_sources.fetched", {
    ai: blocks[0].results.length,
    tech: blocks[1].results.length,
    repos: blocks[2].results.length,
    maxAgeDays: MAX_RESULT_AGE_DAYS
  });
  return blocks;
}
