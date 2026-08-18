import { computeIssueNumber, toEditionDate } from "./date";
import { getEditionByDate, getAdjacentEditionDates, listEditions, saveEdition } from "./db";
import { getGroqModelName, generateGazette } from "./groq";
import { generateGazetteViaGemini, getGeminiModelName } from "./gemini";
import { logServerError } from "./logger";
import { fetchNewsContext } from "./tavily";
import type { EditionRecord, GazetteEdition } from "./types";

export class NoEditionFoundError extends Error {}
export class GenerationFailedError extends Error {}
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("429") || message.includes("rate_limit_exceeded");
}

async function getLatestCachedEdition(): Promise<EditionRecord | null> {
  try {
    const editions = await listEditions();
    if (editions.length === 0) {
      return null;
    }
    // Sort by date descending and return the most recent
    return editions.sort((a, b) => b.date.localeCompare(a.date))[0];
  } catch (error) {
    console.error("Failed to get latest cached edition:", error);
    return null;
  }
}

function createFallbackEdition(date: string): GazetteEdition {
  return {
    headline: {
      title: "The Silicon Gazette",
      deck: "API Limits Reached",
      body: "We've reached our daily API token limit.\n\nPlease check back soon for today's edition.\n\nThis is a technical limitation of our free tier API service.",
      category: "TECH",
      source: "Gazette Desk"
    },
    stories: [
      {
        headline: "Daily Token Limit Reached",
        summary: "The AI news generation service has hit its daily token limit. Our Groq API quota has been exhausted while generating today's edition. A Gemini API fallback is available if configured, otherwise please check back later for fresh content when the quota resets. This is a technical limitation of our free tier API service.",
        category: "TECH",
        source: "Gazette Desk"
      },
      {
        headline: "Rate Limiting in Effect",
        summary: "To maintain service quality and fair API usage across all users, we've temporarily paused new edition generation. Our system includes multiple fallback mechanisms to ensure you can still access recent editions from our archive. We appreciate your patience as we work within API constraints.",
        category: "TECH",
        source: "Gazette Desk"
      },
      {
        headline: "Check Archive for Previous Editions",
        summary: "Browse our archive to read previously generated editions from recent days. Our complete history of daily editions is available for your review. Each edition contains comprehensive tech news analysis, market insights, and open source updates from when it was published.",
        category: "TECH",
        source: "Gazette Desk"
      }
    ],
    repos: [
      {
        name: "groq/groq-sdk",
        description: "Official Groq SDK for language model APIs",
        stars: "4.2K",
        language: "TypeScript"
      }
    ],
    market_brief: "Service temporarily limited by API token constraints."
  };
}

export async function generateEdition(date: string): Promise<EditionRecord> {
  const start = Date.now();
  try {
    const searchContext = await fetchNewsContext();
    const edition = await generateGazette(date, searchContext.serialized);
    const latency = Date.now() - start;

    return saveEdition({
      date,
      issue_num: computeIssueNumber(date),
      content: edition,
      latency_ms: latency,
      model: getGroqModelName()
    });
  } catch (error) {
    logServerError("generateEdition", error);
    
    // Check if this is a rate limit error
    if (isRateLimitError(error)) {
      console.warn("⚠️  Groq rate limit reached. Attempting Gemini fallback...");
      
      // Try Gemini API as second-tier fallback
      try {
        const searchContext = await fetchNewsContext();
        const edition = await generateGazetteViaGemini(date, searchContext.serialized);
        const latency = Date.now() - start;

        return saveEdition({
          date,
          issue_num: computeIssueNumber(date),
          content: edition,
          latency_ms: latency,
          model: getGeminiModelName()
        });
      } catch (geminiError) {
        console.error("❌ Gemini fallback failed:", geminiError);
        
        // Try to use the latest cached edition
        const latestCached = await getLatestCachedEdition();
        if (latestCached) {
          console.warn(`✓ Using cached edition from ${latestCached.date} as fallback`);
          return latestCached;
        }
        
        // Create a fallback edition
        console.warn("⚠️  No cached edition available. Using placeholder edition.");
        const latency = Date.now() - start;
        return {
          id: -1,
          date,
          issue_num: computeIssueNumber(date),
          content: createFallbackEdition(date),
          generated_at: new Date().toISOString(),
          model: "fallback",
          latency_ms: latency
        };
      }
    }
    
    throw new GenerationFailedError("Generation failed after retry. Press breakdown.");
  }
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

export async function getEditionForPage(date: string): Promise<EditionRecord> {
  const today = toEditionDate();
  if (date === today) {
    const result = await getEditionForDate(date, { allowGenerate: true });
    if (!result.edition) {
      throw new NoEditionFoundError(`No edition found for ${date}`);
    }
    return result.edition;
  }

  const result = await getEditionForDate(date, { allowGenerate: false });
  if (!result.edition) {
    throw new NoEditionFoundError(`No edition found for ${date}`);
  }
  return result.edition;
}

export async function listArchive() {
  return listEditions();
}

export { getAdjacentEditionDates };