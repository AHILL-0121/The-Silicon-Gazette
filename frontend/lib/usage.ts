import { db } from "./db";
import { logEvent } from "./logger";
import { apiUsage, factChecks } from "./schema";

// ---------------------------------------------------------------------------
// Best-effort logging for the analytics "Pipeline" section: API usage per
// call and the fact-check outcome per edition. Both are awaited by the
// pipeline (a few ms each) but can never fail it: errors, including a missing
// table before `drizzle-kit push`, are logged once and swallowed.
// ---------------------------------------------------------------------------

export interface ApiUsageInput {
  provider: "groq" | "gemini" | "tavily";
  model?: string;
  kind: "generate" | "search" | "analytics";
  promptTokens?: number | null;
  completionTokens?: number | null;
  credits?: number | null;
  latencyMs?: number | null;
  ok?: boolean;
}

let warned = false;
function warnOnce(event: string, error: unknown): void {
  if (warned) return;
  warned = true;
  logEvent("warn", event, {
    error: error instanceof Error ? error.message : String(error),
    fix: "Run `npx drizzle-kit push` to create the api_usage and fact_checks tables."
  });
}

export async function recordApiUsage(input: ApiUsageInput): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    await db.insert(apiUsage).values({
      provider: input.provider,
      model: input.model ?? "",
      kind: input.kind,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      credits: input.credits ?? null,
      latencyMs: input.latencyMs ?? null,
      ok: input.ok ?? true
    });
  } catch (error) {
    warnOnce("usage.record_failed", error);
  }
}

export interface FactCheckInput {
  date: string;
  model: string;
  storiesIn: number;
  storiesOut: number;
  droppedStories: Array<{ headline: string; reason: string }>;
  trimmedSentences: number;
  headlinesReplaced: number;
  fallbackSummaries: number;
  droppedRepos: number;
  repoFixes: number;
  sourceRelabeled: number;
  marketBriefReplaced: boolean;
  sources: Array<{ host: string; kept: number; dropped: number }>;
}

/** One row per edition date; a retried generation replaces the earlier row. */
export async function recordFactCheck(input: FactCheckInput): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const values = {
    date: input.date,
    model: input.model,
    storiesIn: input.storiesIn,
    storiesOut: input.storiesOut,
    droppedStories: input.droppedStories.length,
    trimmedSentences: input.trimmedSentences,
    headlinesReplaced: input.headlinesReplaced,
    fallbackSummaries: input.fallbackSummaries,
    droppedRepos: input.droppedRepos,
    repoFixes: input.repoFixes,
    sourceRelabeled: input.sourceRelabeled,
    marketBriefReplaced: input.marketBriefReplaced,
    sources: input.sources,
    dropped: input.droppedStories.slice(0, 30).map((d) => ({ headline: d.headline.slice(0, 200), reason: d.reason.slice(0, 200) }))
  };
  try {
    await db.insert(factChecks).values(values).onConflictDoUpdate({ target: factChecks.date, set: { ...values, checkedAt: new Date() } });
  } catch (error) {
    warnOnce("fact_check.record_failed", error);
  }
}

/** Host of a URL without "www.", or "" when it isn't one. */
export function hostOf(url: unknown): string {
  if (typeof url !== "string") return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
