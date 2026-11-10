import type { SearchResult, SearchTopicBlock } from "./types";

/**
 * Everything the models are allowed to know comes from search results. This
 * module decides what counts as usable evidence: it strips page furniture out
 * of snippets, tells articles apart from listing/aggregator pages, and labels
 * how much a result actually says. The grounding validator (grounding.ts)
 * checks model output against exactly the text produced here.
 */

/** Characters of cleaned snippet sent to the models (and used to verify them). */
export const SNIPPET_CHARS = Number(process.env.SNIPPET_CHARS ?? 450);

/** News results older than this are dropped; Tavily's `days` filter is loose. */
export const MAX_RESULT_AGE_DAYS = Number(process.env.MAX_RESULT_AGE_DAYS ?? 3);

/**
 * Hosts that publish lists of links or repos, or user-generated posts, rather
 * than reporting. Their text can name a repo, but a "story" written from them
 * is invented (2026-11-08: three Trendshift stories had no article behind them).
 */
const AGGREGATOR_HOSTS = [
  "trendshift.io",
  "x.com",
  "twitter.com",
  "youtube.com",
  "youtu.be",
  "wangchujiang.com",
  "reddit.com",
  "facebook.com",
  "linkedin.com",
  "tiktok.com",
  "instagram.com"
];

/** GitHub pages that list repos. Single-repo pages (github.com/owner/repo) are fine. */
const GITHUB_LISTING_PREFIXES = ["/explore", "/trending", "/topics", "/collections", "/search", "/sponsors"];

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** True for pages that list things instead of reporting one. */
export function isAggregatorUrl(url: string): boolean {
  const host = hostOf(url);
  if (!host) return true;
  if (AGGREGATOR_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) return true;
  if (host === "github.com") {
    try {
      const path = new URL(url).pathname.toLowerCase();
      return path === "/" || GITHUB_LISTING_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
    } catch {
      return true;
    }
  }
  return false;
}

/** Normalises unicode dashes/quotes so the same word compares equal everywhere. */
export function foldText(text: string): string {
  return text
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, " ");
}

const FURNITURE_PHRASES =
  /skip to (?:main )?content|latest (?:news|stories)|most popular|sign (?:in|up)|subscribe(?: now)?|cookie(?:s)? (?:policy|settings)|accept all|read more|share this|follow us|newsletter/gi;

/**
 * Removes navigation menus, link lists and similar page furniture. Tavily
 * returns these for some sites ("Skip to content Latest news 1. [Razer…]( 2.
 * [Blackpool…]( …"), and models treated the menu items as news.
 */
export function cleanSnippet(content: string | undefined): string {
  if (!content) return "";
  let text = foldText(content);
  // Markdown links and their (usually truncated) targets; menus are mostly these.
  text = text.replace(/!?\[[^\]]*\]\((?:[^)\s]*\))?/g, " ");
  text = text.replace(/\bhttps?:\/\/\S+/g, " ");
  text = text.replace(FURNITURE_PHRASES, " ");
  text = text.replace(/\[\s*\.\.\.\s*\]/g, " … ");
  text = text.replace(/[#*_`|>]+/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return collapseRepeats(text);
}

/** "Tech Insider Tech Insider Tech Insider" -> "Tech Insider". */
function collapseRepeats(text: string): string {
  return text.replace(/\b((?:\S+\s+){0,4}\S+)(?:\s+\1\b)+/gi, "$1");
}

export function wordCount(text: string): number {
  return (text.match(/\S+/g) ?? []).length;
}

export type DetailLevel = "low" | "medium" | "high";

export function detailLevel(snippetWords: number): DetailLevel {
  if (snippetWords < 20) return "low";
  if (snippetWords < 50) return "medium";
  return "high";
}

/** What the models are shown for one result, and what their output is checked against. */
export interface EvidenceEntry {
  url: string;
  title: string;
  /** Cleaned, length-limited snippet: exactly what appears in the prompt. */
  snippet: string;
  published?: string;
  /** Article = reporting about one subject. Listing = aggregator/index page. */
  kind: "article" | "listing";
  detail: DetailLevel;
  /** title + snippet: the text any claim about this result must be supported by. */
  text: string;
}

export function toEvidenceEntry(result: SearchResult): EvidenceEntry {
  const title = foldText(result.title ?? "").replace(/\s+/g, " ").trim();
  const snippet = cleanSnippet(result.content).slice(0, SNIPPET_CHARS).trim();
  return {
    url: result.url,
    title,
    snippet,
    published: result.published_date,
    kind: isAggregatorUrl(result.url) ? "listing" : "article",
    detail: detailLevel(wordCount(snippet)),
    text: `${title}. ${snippet}`
  };
}

/** All distinct results across blocks (first occurrence wins), keyed by URL. */
export function buildEvidenceIndex(blocks: SearchTopicBlock[]): Map<string, EvidenceEntry> {
  const index = new Map<string, EvidenceEntry>();
  for (const block of blocks) {
    for (const result of block.results) {
      if (!result.url || index.has(result.url)) continue;
      index.set(result.url, toEvidenceEntry(result));
    }
  }
  return index;
}

/** True when a published date is parseable and older than the allowed window. */
export function isStale(published: string | undefined, now = Date.now()): boolean {
  if (!published) return false;
  const time = Date.parse(published);
  if (Number.isNaN(time)) return false;
  return now - time > MAX_RESULT_AGE_DAYS * 86_400_000;
}

/**
 * Prompt text for the search results. `articlesOnly` leaves out listing pages;
 * the section calls use it because stories must never be written from them.
 */
export function serializeEvidence(blocks: SearchTopicBlock[], options: { articlesOnly?: boolean } = {}): string {
  const seen = new Set<string>();
  return blocks
    .map(({ topic, results }) => {
      const lines: string[] = [];
      for (const result of results) {
        if (!result.url || seen.has(result.url)) continue;
        const entry = toEvidenceEntry(result);
        if (options.articlesOnly && entry.kind === "listing") continue;
        seen.add(result.url);
        const published = entry.published ? `\n  Published: ${entry.published}` : "";
        lines.push(
          `- ${entry.title}\n  URL: ${entry.url}${published}\n  Type: ${entry.kind}\n  Evidence: ${entry.detail}\n  Snippet: ${entry.snippet || "(none)"}`
        );
      }
      return lines.length ? `=== ${topic} ===\n${lines.join("\n")}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}
