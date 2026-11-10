import { buildEvidenceIndex } from "./evidence";
import { fetchFreeContext } from "./free-sources";
import { logEvent } from "./logger";
import { buildSearchContext, fetchNewsContext as fetchTavilyContext } from "./tavily";
import type { Repo, SearchContext, SearchResult, SearchTopicBlock } from "./types";
import { formatStars } from "./free-sources";

/**
 * Where the day's evidence comes from. Free sources (publisher RSS, Hacker
 * News, GitHub) are tried first; Tavily is only searched when they return too
 * few usable articles, which also saves its quota. Set NEWS_SOURCES=tavily to
 * skip the free sources, or NEWS_SOURCES=free to never call Tavily.
 */
const MODE = (process.env.NEWS_SOURCES ?? "auto").toLowerCase();

/** Fewer article results than this and Tavily is asked to top up. */
const MIN_FREE_ARTICLES = Number(process.env.MIN_FREE_ARTICLES ?? 8);

function countArticles(blocks: SearchTopicBlock[]): number {
  return [...buildEvidenceIndex(blocks).values()].filter((entry) => entry.kind === "article").length;
}

function mergeBlocks(primary: SearchTopicBlock[], extra: SearchTopicBlock[]): SearchTopicBlock[] {
  const seen = new Set(primary.flatMap((block) => block.results.map((result) => result.url)));
  const merged = primary.map((block) => ({ ...block, results: [...block.results] }));
  for (const block of extra) {
    const target = merged.find((candidate) => candidate.topic === block.topic);
    const fresh = block.results.filter((result) => !seen.has(result.url));
    fresh.forEach((result) => seen.add(result.url));
    if (target) target.results.push(...fresh);
    else merged.push({ ...block, results: fresh });
  }
  return merged;
}

export async function fetchNewsContext(): Promise<SearchContext> {
  if (MODE === "tavily") return fetchTavilyContext();

  let blocks: SearchTopicBlock[] = [];
  try {
    blocks = await fetchFreeContext();
  } catch (error) {
    logEvent("warn", "news.free_failed", { error: error instanceof Error ? error.message : String(error) });
    if (MODE === "free") throw error;
  }

  const articles = countArticles(blocks);
  if (MODE === "free" || articles >= MIN_FREE_ARTICLES) {
    return buildSearchContext(blocks);
  }

  logEvent("warn", "news.tavily_topup", { freeArticles: articles, minimum: MIN_FREE_ARTICLES });
  try {
    const tavily = await fetchTavilyContext();
    return buildSearchContext(blocks.length ? mergeBlocks(blocks, tavily.blocks) : tavily.blocks);
  } catch (error) {
    // Tavily is the top-up: a few free articles are still worth publishing from.
    if (articles >= 4) return buildSearchContext(blocks);
    throw error;
  }
}

/**
 * The repo watch, built from GitHub's own data instead of model output: name,
 * star count, language and description cannot be misread or invented. Repos
 * featured in the past week are skipped. Returns null when the free GitHub
 * source gave too few repos, so the (fact-checked) model output is used.
 */
export function repoWatchFromBlocks(blocks: SearchTopicBlock[], recentRepoNames: Set<string>, count = 5): Repo[] | null {
  const repos = blocks
    .flatMap((block) => block.results)
    .filter((result): result is SearchResult & { repo: NonNullable<SearchResult["repo"]> } => Boolean(result.repo))
    .map((result) => result.repo)
    .filter((repo) => !recentRepoNames.has(repo.name.toLowerCase()))
    .sort((a, b) => b.stars - a.stars);
  if (repos.length < 3) return null;
  return repos.slice(0, count).map((repo) => ({
    name: repo.name,
    description: repo.description.length >= 5 ? repo.description : "New repository on GitHub.",
    stars: formatStars(repo.stars),
    language: repo.language
  }));
}
