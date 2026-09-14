import { computeIssueNumber, toEditionDate } from "./date";
import {
  getAdjacentEditionDates,
  getEditionByDate,
  getLatestEditionDate,
  listEditionSummaries,
  saveEdition
} from "./db";
import { normalizeEdition } from "./gazette";
import { generateGazetteViaGemini, getGeminiModelName, isGeminiConfigured } from "./gemini";
import { generateGazette, getGroqModelName, type RawEdition } from "./groq";
import { logServerError } from "./logger";
import { fetchNewsContext } from "./tavily";
import type { EditionRecord } from "./types";

export class NoEditionFoundError extends Error { }
export class GenerationFailedError extends Error { }

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
    logServerError("generateEdition:groq", groqError);
    if (!isGeminiConfigured()) {
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

/**
 * Generates and stores the edition for `date`. Concurrent callers share one
 * pipeline run, and a recent failure short-circuits instead of re-running the
 * whole paid pipeline for every visitor.
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

  const run = runPipeline(date)
    .then((record) => {
      failures.delete(date);
      return record;
    })
    .catch((error) => {
      failures.set(date, Date.now());
      logServerError("generateEdition", error);
      throw new GenerationFailedError("Generation failed after retry. Press breakdown.");
    })
    .finally(() => {
      inflight.delete(date);
    });

  inflight.set(date, run);
  return run;
}

export async function getEditionForDate(
  date: string,
  options?: { allowGenerate?: boolean }
): Promise<{ edition: EditionRecord | null; cached: boolean }> {
  const cachedEdition = await getEditionByDate(date);
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

export async function listArchive() {
  return listEditionSummaries();
}

export { getAdjacentEditionDates, getLatestEditionDate };
