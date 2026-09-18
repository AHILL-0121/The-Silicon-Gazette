import { unstable_cache } from "next/cache";
import { cache } from "react";

import { compareEditionDate, computeIssueNumber, toEditionDate } from "./date";
import {
  getAdjacentEditionDates,
  getEditionByDate,
  getLatestEditionDate,
  listEditionStoryIndex,
  listEditionSummariesPage,
  saveEdition
} from "./db";
import { buildEditionView, visibleStorySlugs, type EditionView } from "./edition-view";
import { normalizeEdition } from "./gazette";
import { sendAlert } from "./alerts";
import { claimGenerationRun } from "./budget";
import { acquireGenerationLock } from "./generation-lock";
import { generateGazetteViaGemini, getGeminiModelName, isGeminiConfigured } from "./gemini";
import { generateGazette, getGroqModelName, type RawEdition } from "./groq";
import { errorFields, logEvent, logServerError } from "./logger";
import { fetchNewsContext } from "./tavily";
import type { ArchivePage, ArchiveQuery, EditionRecord } from "./types";

export class NoEditionFoundError extends Error {}
export class GenerationFailedError extends Error {}

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

async function runPipeline(date: string): Promise<EditionRecord> {
  const start = Date.now();
  // Search once and reuse the results for the fallback provider.
  const searchContext = await fetchNewsContext();
  const allowedUrls = new Set(
    searchContext.blocks.flatMap((block) => block.results.map((result) => result.url))
  );

  let raw: RawEdition;
  let model: string;
  try {
    raw = await generateGazette(date, searchContext.serialized);
    model = getGroqModelName();
    normalizeEdition(raw, { allowedUrls });
  } catch (groqError) {
    logServerError("generation.groq_failed", groqError, { date, elapsedMs: Date.now() - start });
    if (!isGeminiConfigured()) {
      throw groqError;
    }
    if (Date.now() - start > FALLBACK_CUTOFF_MS) {
      logEvent("warn", "generation.fallback_skipped", { date, reason: "not enough time left", elapsedMs: Date.now() - start });
      throw groqError;
    }
    raw = await generateGazetteViaGemini(date, searchContext.serialized);
    model = getGeminiModelName();
  }

  const content = normalizeEdition(raw, { allowedUrls });
  return saveEdition({
    date,
    issue_num: computeIssueNumber(date),
    content,
    latency_ms: Date.now() - start,
    model
  });
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

async function runLockedPipeline(date: string): Promise<EditionRecord> {
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
      throw new GenerationFailedError(`Daily generation budget exhausted (${budget.used}/${budget.limit}).`);
    }
    return await runPipeline(date);
  } finally {
    if (lock.status === "acquired") await lock.release();
  }
}

/**
 * Generates and stores the edition for `date`. Concurrent callers in this
 * instance share one run, other instances wait on a Redis lock, and a recent
 * failure short-circuits instead of re-running the paid pipeline per visitor.
 */
export async function generateEdition(date: string): Promise<EditionRecord> {
  const running = inflight.get(date);
  if (running) {
    return running;
  }

  const failedAt = failures.get(date);
  if (failedAt && Date.now() - failedAt < FAILURE_COOLDOWN_MS) {
    throw new GenerationFailedError("The presses are cooling down after a failed run. Try again shortly.");
  }

  const run = runLockedPipeline(date)
    .then((record) => {
      failures.delete(date);
      logEvent("info", "generation.succeeded", { date, model: record.model, latencyMs: record.latency_ms });
      return record;
    })
    .catch(async (error) => {
      failures.set(date, Date.now());
      logServerError("generation.failed", error, { date });
      await sendAlert(`generation-failed:${date}`, `Edition ${date} failed to generate.`, {
        edition: date,
        ...errorFields(error),
        stack: undefined
      });
      throw new GenerationFailedError("Generation failed after retry. Press breakdown.");
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
  options?: { allowGenerate?: boolean }
): Promise<{ edition: EditionRecord | null; cached: boolean }> {
  const cachedEdition = await readEdition(date);
  if (cachedEdition) {
    return { edition: cachedEdition, cached: true };
  }

  if (!options?.allowGenerate) {
    return { edition: null, cached: false };
  }

  const generated = await generateEdition(date);
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

