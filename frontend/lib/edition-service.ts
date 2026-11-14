import { unstable_cache } from "next/cache";
import { cache } from "react";

import { compareEditionDate, computeIssueNumber, toEditionDate } from "./date";
import {
  getAdjacentEditionDates,
  getEditionByDate,
  getLatestEditionDate,
  getRecentHeadlines,
  getRecentRepoNames,
  getRecentSourceUrls,
  getSearchContext,
  listEditionStoryIndex,
  listEditionSummariesPage,
  saveEdition,
  saveSearchContext
} from "./db";
import { buildEditionView, visibleStorySlugs, type EditionView } from "./edition-view";
import { GazetteEditionSchema, normalizeEditionCandidate } from "./gazette";
import { buildEvidenceIndex } from "./evidence";
import { groundEdition, type GroundingReport } from "./grounding";
import { sendAlert, sendNotice } from "./alerts";
import { claimGenerationRun } from "./budget";
import { acquireGenerationLock } from "./generation-lock";
import { generateGazetteViaGemini, getGeminiModelName, isGeminiConfigured } from "./gemini";
import { generateGazette, getGroqModelName, type RawEdition } from "./groq";
import { errorFields, logEvent, logServerError } from "./logger";
import { absoluteUrl } from "./site";
import { TavilyError, buildSearchContext } from "./tavily";
import { hostOf, recordFactCheck } from "./usage";
import { fetchNewsContext, repoWatchFromBlocks } from "./news";
import type { ArchivePage, ArchiveQuery, EditionRecord, GazetteEdition, Repo, SearchContext } from "./types";

export class NoEditionFoundError extends Error {}
export class GenerationFailedError extends Error {}
/** Retrying is pointless until the next UTC day, so callers shouldn't. */
export class BudgetExhaustedError extends GenerationFailedError {}

/** What started a generation run; named in the Slack notices. */
export type GenerationTrigger = "github-actions" | "vercel-cron" | "live-visit";

const TRIGGER_LABELS: Record<GenerationTrigger, string> = {
  "github-actions": "GitHub Actions",
  "vercel-cron": "Vercel Cron (backup)",
  "live-visit": "Live Visit"
};

/** Only try the Gemini fallback if Groq failed early enough to leave it time. */
const FALLBACK_CUTOFF_MS = Number(process.env.GEMINI_FALLBACK_CUTOFF_MS ?? 150_000);

/** After a failed run, wait this long before spending API quota again. */
const FAILURE_COOLDOWN_MS = 10 * 60 * 1000;

const generationState = globalThis as typeof globalThis & {
  __gazetteInflight?: Map<string, Promise<EditionRecord>>;
  __gazetteFailures?: Map<string, number>;
};
const inflight = (generationState.__gazetteInflight ??= new Map());
const failures = (generationState.__gazetteFailures ??= new Map());

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Tavily is searched once per day. The results are stored before the models
 * run, so a retry after a model failure reuses them instead of spending search
 * quota again. If the stored copy can't be read (e.g. the table is missing),
 * a fresh search keeps generation working.
 */
async function loadNewsContext(date: string): Promise<{ context: SearchContext; reused: boolean }> {
  try {
    const blocks = await getSearchContext(date);
    if (blocks) {
      return { context: buildSearchContext(blocks), reused: true };
    }
  } catch (error) {
    logServerError("search_context.read_failed", error, { date });
  }

  const context = await fetchNewsContext();
  // An empty search is not worth keeping: the next attempt should search again.
  if (context.blocks.some((block) => block.results.length > 0)) {
    try {
      await saveSearchContext(date, context.blocks);
    } catch (error) {
      logServerError("search_context.save_failed", error, { date });
    }
  }
  return { context, reused: false };
}

/**
 * Two days, not more: every headline is sent with each of the ~7 model calls,
 * and Groq's on_demand tier allows 8,000 tokens per minute.
 */
const RECENT_COVERAGE_DAYS = 2;

/** Headlines the models should not repeat. Losing them must not stop the paper. */
async function loadRecentHeadlines(date: string): Promise<string[]> {
  try {
    return await getRecentHeadlines(date, RECENT_COVERAGE_DAYS);
  } catch (error) {
    logServerError("recent_headlines.read_failed", error, { date });
    return [];
  }
}

/** A source used within this many days is skipped unless the edition would run short. */
const SOURCE_REUSE_DAYS = 7;

async function loadRecentSourceUrls(date: string): Promise<Set<string>> {
  try {
    return new Set(await getRecentSourceUrls(date, SOURCE_REUSE_DAYS));
  } catch (error) {
    logServerError("recent_sources.read_failed", error, { date });
    return new Set();
  }
}

export interface VerifyContext {
  allowedUrls: Set<string>;
  evidenceIndex: ReturnType<typeof buildEvidenceIndex>;
  recentUrls: Set<string>;
  /** GitHub's own repo data; replaces whatever repos the model wrote. */
  githubRepos: Repo[] | null;
}

/**
 * Normalises the model output, then fact-checks it against the search results:
 * unsupported stories, sentences, numbers and repos are removed before the
 * edition can be saved. Throws if what is left is not publishable.
 */
export function verifyEdition(raw: RawEdition, context: VerifyContext): { content: GazetteEdition; report: GroundingReport } {
  const normalized = normalizeEditionCandidate(
    context.githubRepos ? { ...raw, repos: context.githubRepos } : raw,
    { allowedUrls: context.allowedUrls }
  ) as GazetteEdition;
  const grounded = groundEdition(normalized, context.evidenceIndex, { recentUrls: context.recentUrls });
  return { content: GazetteEditionSchema.parse(grounded.edition), report: grounded.report };
}

async function loadRecentRepoNames(date: string): Promise<Set<string>> {
  try {
    return new Set(await getRecentRepoNames(date, SOURCE_REUSE_DAYS));
  } catch (error) {
    logServerError("recent_repos.read_failed", error, { date });
    return new Set();
  }
}

async function runPipeline(
  date: string,
  budget: { used: number; limit: number },
  trigger: GenerationTrigger
): Promise<EditionRecord> {
  const start = Date.now();
  // Search once and reuse the results for the fallback provider. Without
  // search results there is nothing to report, so name the reason and stop.
  let searchContext: SearchContext;
  let searchReused: boolean;
  try {
    ({ context: searchContext, reused: searchReused } = await loadNewsContext(date));
  } catch (error) {
    logServerError("generation.search_failed", error, { date, elapsedMs: Date.now() - start });
    const reason = error instanceof TavilyError ? error.publicReason : "news search failed";
    throw new GenerationFailedError(`Generation failed: ${reason}.`, { cause: error });
  }
  const allowedUrls = new Set(
    searchContext.blocks.flatMap((block) => block.results.map((result) => result.url))
  );
  const searchMs = Date.now() - start;
  const recentHeadlines = await loadRecentHeadlines(date);
  const recentUrls = await loadRecentSourceUrls(date);
  const evidenceIndex = buildEvidenceIndex(searchContext.blocks);
  // GitHub's own data (when available) replaces model-written repo entries.
  const githubRepos = repoWatchFromBlocks(searchContext.blocks, await loadRecentRepoNames(date));
  let report: GroundingReport | undefined;

  const verify = (candidate: RawEdition): GazetteEdition => {
    const result = verifyEdition(candidate, { allowedUrls, evidenceIndex, recentUrls, githubRepos });
    report = result.report;
    return result.content;
  };
  let fallbackReason: string | undefined;

  let raw: RawEdition;
  let model: string;
  try {
    raw = await generateGazette(date, searchContext.serialized, recentHeadlines, searchContext.articles);
    model = getGroqModelName();
    verify(raw);
  } catch (groqError) {
    logServerError("generation.groq_failed", groqError, { date, elapsedMs: Date.now() - start });
    if (!isGeminiConfigured()) {
      throw groqError;
    }
    if (Date.now() - start > FALLBACK_CUTOFF_MS) {
      logEvent("warn", "generation.fallback_skipped", { date, reason: "not enough time left", elapsedMs: Date.now() - start });
      throw groqError;
    }
    fallbackReason = groqError instanceof Error ? groqError.message : String(groqError);
    try {
      raw = await generateGazetteViaGemini(date, searchContext.serialized, recentHeadlines, searchContext.articles);
    } catch (geminiError) {
      // Name both failures so the alert shows why Groq failed, not just the fallback.
      const geminiReason = geminiError instanceof Error ? geminiError.message : String(geminiError);
      throw new Error(`Groq failed: ${fallbackReason.slice(0, 300)} | Gemini fallback failed: ${geminiReason.slice(0, 300)}`, {
        cause: geminiError
      });
    }
    model = getGeminiModelName();
  }

  const content = verify(raw);
  if (report) {
    logEvent("info", "generation.grounding", {
      date,
      droppedStories: report.droppedStories,
      trimmedSentences: report.trimmedSentences,
      headlinesReplaced: report.headlinesReplaced,
      fallbackSummaries: report.fallbackSummaries,
      repoFixes: report.repoFixes,
      droppedRepos: report.droppedRepos,
      sourceRelabeled: report.sourceRelabeled,
      marketBriefReplaced: report.marketBriefReplaced
    });
  }
  const record = await saveEdition({
    date,
    issue_num: computeIssueNumber(date),
    content,
    latency_ms: Date.now() - start,
    model
  });

  if (report) {
    // Fact-check history for the analytics Pipeline section; never fails the run.
    try {
      const hosts = new Map<string, { kept: number; dropped: number }>();
      for (const story of raw.stories) {
        const host = hostOf((story as { url?: unknown } | null)?.url);
        if (host) hosts.set(host, { kept: 0, dropped: (hosts.get(host)?.dropped ?? 0) + 1 });
      }
      for (const story of content.stories) {
        const entry = hosts.get(hostOf(story.url));
        if (entry && entry.dropped > 0) {
          entry.kept += 1;
          entry.dropped -= 1;
        }
      }
      await recordFactCheck({
        date,
        model,
        storiesIn: raw.stories.length,
        storiesOut: content.stories.length,
        droppedStories: report.droppedStories,
        trimmedSentences: report.trimmedSentences,
        headlinesReplaced: report.headlinesReplaced,
        fallbackSummaries: report.fallbackSummaries,
        droppedRepos: report.droppedRepos.length,
        repoFixes: report.repoFixes.length,
        sourceRelabeled: report.sourceRelabeled,
        marketBriefReplaced: report.marketBriefReplaced,
        sources: [...hosts.entries()].map(([host, counts]) => ({ host, ...counts }))
      });
    } catch (error) {
      logEvent("warn", "fact_check.prepare_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  const linkedSources = new Set(
    [content.headline.url, ...content.stories.map((story) => story.url)].filter((url): url is string => Boolean(url))
  );
  await sendNotice(`generation-succeeded:${date}`, `Edition ${date} (No. ${record.issue_num}) published.`, {
    generatedFrom: TRIGGER_LABELS[trigger],
    lead: `[${content.headline.category}] ${content.headline.title}`,
    contents: `${content.stories.length} stories, ${content.repos.length} repos, market brief ${content.market_brief ? "included" : "missing"}`,
    factCheck: report
      ? `${report.droppedStories.length} stories dropped, ${report.trimmedSentences} unsupported sentences removed, ${report.headlinesReplaced} headlines replaced by source titles, ${report.droppedRepos.length} repos dropped, ${report.repoFixes.length} repo fields blanked`
      : "not run",
    sources: `${linkedSources.size} linked of ${allowedUrls.size} search results${searchReused ? " (reused from an earlier attempt)" : ""}`,
    // 450, not 200: Groq's rate-limit message ends with "Requested N. Please try
    // again in Xs", and that tail is what explains the failure.
    model: fallbackReason ? `${model} (Gemini fallback; Groq failed: ${fallbackReason.slice(0, 450)})` : model,
    timing: `${seconds(record.latency_ms ?? Date.now() - start)} total (search ${seconds(searchMs)}, writing ${seconds((record.latency_ms ?? 0) - searchMs)})`,
    budget: `run ${budget.used} of ${budget.limit} today`,
    url: absoluteUrl(`/gazette/${date}`)
  });
  return record;
}

const LOCK_POLL_INTERVAL_MS = 5_000;
const LOCK_WAIT_MS = 280_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Another instance holds the lock: wait for its edition to land in the database. */
async function waitForOtherInstance(date: string): Promise<EditionRecord> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    await wait(LOCK_POLL_INTERVAL_MS);
    const stored = await getEditionByDate(date);
    if (stored) return stored;
    const lock = await acquireGenerationLock(date);
    if (lock.status === "acquired") {
      // The other run finished without saving (it failed). Don't retry here;
      // the failure cooldown applies to this date.
      await lock.release();
      throw new Error(`Another instance failed to generate ${date}`);
    }
  }
  throw new Error(`Timed out waiting for another instance to generate ${date}`);
}

async function runLockedPipeline(date: string, trigger: GenerationTrigger): Promise<EditionRecord> {
  const lock = await acquireGenerationLock(date);
  if (lock.status === "busy") {
    return waitForOtherInstance(date);
  }
  try {
    // The edition may have been saved between the page's read and the lock.
    const stored = await getEditionByDate(date);
    if (stored) return stored;
    const budget = await claimGenerationRun(date);
    if (!budget.allowed) {
      throw new BudgetExhaustedError(`Daily generation budget exhausted (${budget.used}/${budget.limit}).`);
    }
    return await runPipeline(date, budget, trigger);
  } finally {
    if (lock.status === "acquired") await lock.release();
  }
}

/**
 * Generates and stores the edition for `date`. Concurrent callers in this
 * instance share one run, other instances wait on a Redis lock, and a recent
 * failure short-circuits instead of re-running the paid pipeline per visitor.
 * Trusted callers (cron, maintainers) skip that cooldown so their retries
 * actually retry; the daily budget still caps how many runs they can start.
 */
export async function generateEdition(
  date: string,
  options?: { ignoreCooldown?: boolean; trigger?: GenerationTrigger }
): Promise<EditionRecord> {
  const trigger = options?.trigger ?? "live-visit";
  const running = inflight.get(date);
  if (running) {
    return running;
  }

  const failedAt = failures.get(date);
  if (!options?.ignoreCooldown && failedAt && Date.now() - failedAt < FAILURE_COOLDOWN_MS) {
    throw new GenerationFailedError("The presses are cooling down after a failed run. Try again shortly.");
  }

  const run = runLockedPipeline(date, trigger)
    .then((record) => {
      failures.delete(date);
      logEvent("info", "generation.succeeded", { date, model: record.model, latencyMs: record.latency_ms });
      return record;
    })
    .catch(async (error) => {
      failures.set(date, Date.now());
      logServerError("generation.failed", error, { date });
      const { error: message, errorName, cause } = errorFields(error);
      await sendAlert(`generation-failed:${date}`, `Edition ${date} failed to generate.`, {
        reason: message,
        type: errorName,
        cause,
        generatedFrom: TRIGGER_LABELS[trigger],
        attempt: options?.ignoreCooldown ? "trusted caller (cron/maintainer)" : "reader request",
        nextStep: options?.ignoreCooldown
          ? "retry via the Generate Today's Edition workflow"
          : `reader requests paused for ${FAILURE_COOLDOWN_MS / 60_000} min`
      });
      // Keep specific reasons (e.g. budget exhausted) so callers can report them.
      if (error instanceof GenerationFailedError) throw error;
      // The cause carries the provider error; the route shows it to trusted callers only.
      throw new GenerationFailedError("Generation failed after retry. Press breakdown.", { cause: error });
    })
    .finally(() => {
      inflight.delete(date);
    });

  inflight.set(date, run);
  return run;
}

export const EDITIONS_TAG = "editions";
export const editionTag = (date: string) => `edition:${date}`;

/** Thrown inside the cached read so a missing edition is never cached. */
class EditionNotStored extends Error {}

/**
 * A printed edition never changes, so once an edition exists (today's
 * included) it is served from the Next data cache instead of querying Neon on
 * every view. "Not printed yet" is never cached: today's page keeps checking
 * until the edition lands, and a backfilled past date shows up immediately.
 * Future dates skip the database entirely. React `cache` shares one read
 * between generateMetadata and the page within a request.
 */
export const readEdition = cache(async (date: string): Promise<EditionRecord | null> => {
  if (compareEditionDate(date, toEditionDate()) > 0) return null;
  try {
    return await unstable_cache(
      async () => {
        const edition = await getEditionByDate(date);
        if (!edition) throw new EditionNotStored(date);
        return edition;
      },
      ["edition", date],
      { tags: [editionTag(date), EDITIONS_TAG], revalidate: 86_400 }
    )();
  } catch (error) {
    if (error instanceof EditionNotStored) return null;
    throw error;
  }
});

/**
 * The stored edition plus its render-ready view. Memoised per request, so
 * generateMetadata and the page build the view (dedupe, slugs, sections) once.
 */
export const readEditionView = cache(
  async (date: string): Promise<{ edition: EditionRecord; view: EditionView } | null> => {
    const edition = await readEdition(date);
    return edition ? { edition, view: buildEditionView(edition.content, date) } : null;
  }
);

export const readAdjacentEditionDates = cache(async (date: string) => {
  return unstable_cache(() => getAdjacentEditionDates(date), ["adjacent", date], {
    tags: [EDITIONS_TAG],
    revalidate: 600
  })();
});

export const ARCHIVE_PAGE_SIZE = 30;

/** A page of the archive, cached for 5 minutes per (page, search, category). */
export function readArchivePage(query: Omit<ArchiveQuery, "pageSize">): Promise<ArchivePage> {
  const q = query.q?.trim().slice(0, 100) || undefined;
  return unstable_cache(
    () => listEditionSummariesPage({ ...query, q, pageSize: ARCHIVE_PAGE_SIZE }),
    ["archive-page", String(query.page), q ?? "", query.category ?? ""],
    { tags: [EDITIONS_TAG], revalidate: 300 }
  )();
}

/**
 * Story page slugs per edition, for the sitemap. Summaries are needed to
 * apply the duplicate rules, but only the resulting slugs are cached (the raw
 * index is larger than the 2 MB data-cache limit).
 */
export const readSitemapIndex = unstable_cache(
  async () =>
    (await listEditionStoryIndex()).map((edition) => ({
      date: edition.date,
      generated_at: edition.generated_at,
      slugs: visibleStorySlugs(edition.stories, edition.lead)
    })),
  ["sitemap-index"],
  { tags: [EDITIONS_TAG], revalidate: 3600 }
);

export const readLatestEditionDate = unstable_cache(() => getLatestEditionDate(), ["latest-date"], {
  tags: [EDITIONS_TAG],
  revalidate: 300
});

export async function getEditionForDate(
  date: string,
  options?: { allowGenerate?: boolean; ignoreCooldown?: boolean; trigger?: GenerationTrigger }
): Promise<{ edition: EditionRecord | null; cached: boolean }> {
  const cachedEdition = await readEdition(date);
  if (cachedEdition) {
    return { edition: cachedEdition, cached: true };
  }

  if (!options?.allowGenerate) {
    return { edition: null, cached: false };
  }

  const generated = await generateEdition(date, {
    ignoreCooldown: options.ignoreCooldown,
    trigger: options.trigger
  });
  return { edition: generated, cached: false };
}

/** Only today's edition may be generated on page view; past dates are read-only. */
export async function getEditionForPage(date: string): Promise<EditionRecord> {
  const result = await getEditionForDate(date, { allowGenerate: date === toEditionDate() });
  if (!result.edition) {
    throw new NoEditionFoundError(`No edition found for ${date}`);
  }
  return result.edition;
}

