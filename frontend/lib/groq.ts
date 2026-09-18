import Groq from "groq-sdk";

import { isRateLimitError, parseModelJsonValue } from "./gazette";
import { logEvent } from "./logger";
import type { Category } from "./types";

const MODEL_NAME = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

/**
 * gpt-oss models spend part of `max_tokens` on hidden reasoning. At the
 * default ("medium") effort a section call could run out of tokens before the
 * JSON was complete, and editions took 80-215 s. "low" keeps the output whole
 * and the pipeline fast. Ignored for models without reasoning support.
 */
const REASONING_EFFORT = process.env.GROQ_REASONING_EFFORT || "low";

/** Per-call timeout. The SDK's own retries are off; completeWithGroq retries once itself. */
const GROQ_TIMEOUT_MS = Number(process.env.GROQ_TIMEOUT_MS ?? 45_000);

/**
 * Sections stop being requested once this much time has passed since
 * generation began, and the edition is published with the stories written so
 * far (validation still requires at least 4). Keeps a slow provider day inside
 * the 300 s function limit.
 */
const SECTIONS_BUDGET_MS = Number(process.env.GROQ_SECTIONS_BUDGET_MS ?? 170_000);

function reasoningOptions(): Record<string, string> {
  return MODEL_NAME.includes("gpt-oss") ? { reasoning_effort: REASONING_EFFORT } : {};
}

export type RawEdition = {
  headline?: unknown;
  stories: unknown[];
  repos?: unknown;
  market_brief?: unknown;
};

/**
 * Story sections, one model call each. Counts add up to the 12 stories the
 * edition layout is designed for, and each section maps to one category so
 * the section pages are filled without repeating stories.
 */
export const STORY_SECTIONS: Array<{ name: string; category: Category; count: number }> = [
  { name: "Machine Intelligence", category: "AI", count: 3 },
  { name: "Tech Dispatch", category: "TECH", count: 2 },
  { name: "Startup & Funding", category: "STARTUP", count: 2 },
  { name: "Open Source", category: "OPEN SOURCE", count: 2 },
  { name: "Hardware & Systems", category: "HARDWARE", count: 1 },
  { name: "Security & Privacy", category: "SECURITY", count: 2 }
];

function getGroqApiKeys(): string[] {
  const keys = new Set<string>();
  const primary = process.env.GROQ_API_KEY?.trim();
  if (primary) {
    keys.add(primary);
  }

  const list = process.env.GROQ_API_KEYS ?? "";
  for (const entry of list.split(/[\s,]+/)) {
    const trimmed = entry.trim();
    if (trimmed) {
      keys.add(trimmed);
    }
  }

  return Array.from(keys);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildSystemPrompt(): string {
  return `You are the editor of The Silicon Gazette, a daily broadsheet for the tech industry.
Compose today's edition using ONLY the news provided in the search results as source material.
Never invent companies, numbers, quotes or links. Respond with valid JSON only, no markdown fencing or commentary.`;
}

function formatExclusions(usedHeadlines: string[]): string {
  if (usedHeadlines.length === 0) return "";
  return `
Already covered elsewhere in this edition (do NOT write about these events again, even with different wording):
${usedHeadlines.map((headline) => `- ${headline}`).join("\n")}
`;
}

export function buildSectionPrompt(
  section: { name: string; category: Category; count: number },
  usedHeadlines: string[]
): string {
  return `Write up to ${section.count} news stories for the "${section.name}" section (category ${section.category}).
Respond with ONLY a JSON array:
[
  {
    "headline": string,
    "summary": string,
    "category": "AI"|"TECH"|"OPEN SOURCE"|"STARTUP"|"HARDWARE"|"SECURITY",
    "source": string,
    "url": string
  }
]
${formatExclusions(usedHeadlines)}
Rules:
- Every story must cover a DIFFERENT news event from the search results.
- If there are fewer distinct events that fit this section, return fewer stories rather than repeating one.
- headline: newspaper style, at most 14 words.
- summary: 2-3 paragraphs separated by \\n\\n, 150-250 words in total, with context and implications.
- source: the publication name of the result you used.
- url: copy the exact URL of the result you used from the search results.`;
}

export function buildMainEditionPrompt(date: string): string {
  return `Today's date: ${date}

Generate the lead story and repository watch as a JSON object:
{
  "headline": {
    "title": string,
    "deck": string,
    "body": string,
    "category": "AI"|"TECH"|"OPEN SOURCE"|"STARTUP"|"HARDWARE"|"SECURITY",
    "source": string,
    "url": string
  },
  "repos": [
    { "name": string, "description": string, "stars": string, "language": string }
  ],
  "market_brief": string
}

Rules:
- headline.title: 7-12 word headline for the single most important story.
- headline.deck: 1-2 sentence subheading.
- headline.body: exactly 3 paragraphs separated by \\n\\n.
- headline.url: copy the exact URL of the main source from the search results.
- repos: exactly 5 distinct GitHub repositories mentioned in the search results, name in owner/repo format.
- repos[].stars: star count from the results (e.g. "14.2k"), or "—" if unknown. Never guess.
- market_brief: one sentence under 220 characters.`;
}

async function completeWithGroq(userPrompt: string, maxTokens: number): Promise<string> {
  const apiKeys = getGroqApiKeys();
  if (apiKeys.length === 0) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  let lastError: unknown;
  for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex += 1) {
    const groq = new Groq({ apiKey: apiKeys[keyIndex], timeout: GROQ_TIMEOUT_MS, maxRetries: 0 });
    for (let attempt = 0; attempt <= 1; attempt += 1) {
      try {
        const completion = await groq.chat.completions.create({
          model: MODEL_NAME,
          max_tokens: maxTokens,
          temperature: 0.4,
          // groq-sdk 0.7 predates this parameter; the API accepts it.
          ...(reasoningOptions() as object),
          messages: [
            { role: "system", content: buildSystemPrompt() },
            { role: "user", content: userPrompt }
          ]
        });
        return completion.choices[0]?.message?.content ?? "";
      } catch (error) {
        lastError = error;
        if (isRateLimitError(error)) {
          if (keyIndex < apiKeys.length - 1) {
            logEvent("warn", "groq.rate_limited", { switchingToKey: keyIndex + 2, keys: apiKeys.length });
          }
          break;
        }
        if (attempt < 1) {
          await wait(300);
        }
      }
    }
  }

  throw lastError;
}

export async function generateGazette(date: string, searchContext: string): Promise<RawEdition> {
  const startedAt = Date.now();
  const mainRaw = await completeWithGroq(`${searchContext}\n\n${buildMainEditionPrompt(date)}`, 2000);
  const mainEdition = parseModelJsonValue(mainRaw, "object") as Record<string, unknown>;

  const leadTitle = (mainEdition.headline as { title?: unknown } | undefined)?.title;
  const usedHeadlines: string[] = typeof leadTitle === "string" ? [leadTitle] : [];
  const stories: unknown[] = [];

  // Sections run sequentially so each call knows which events are already
  // covered; this is what prevents the same story appearing 3-4 times.
  for (const section of STORY_SECTIONS) {
    if (Date.now() - startedAt > SECTIONS_BUDGET_MS) {
      logEvent("warn", "generation.sections_budget_reached", {
        date,
        skippedFrom: section.name,
        storiesSoFar: stories.length
      });
      break;
    }
    try {
      const raw = await completeWithGroq(
        `${searchContext}\n\n${buildSectionPrompt(section, usedHeadlines)}`,
        2000
      );
      const parsed = parseModelJsonValue(raw, "array") as Array<Record<string, unknown> | null>;
      for (const story of parsed.slice(0, section.count)) {
        if (!story) continue;
        stories.push({ ...story, category: story.category ?? section.category });
        if (typeof story.headline === "string") usedHeadlines.push(story.headline);
      }
    } catch (error) {
      if (isRateLimitError(error)) {
        logEvent("error", "generation.section_rate_limited", { date, section: section.name });
        throw error;
      }
      // A failed section is skipped; validation later decides whether enough
      // stories remain to publish. No filler copy is invented.
      logEvent("warn", "generation.section_failed", {
        date,
        section: section.name,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    headline: mainEdition.headline,
    stories,
    repos: mainEdition.repos,
    market_brief: mainEdition.market_brief
  };
}

export function getGroqModelName(): string {
  return MODEL_NAME;
}
