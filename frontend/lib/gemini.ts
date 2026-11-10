import { parseModelJsonValue } from "./gazette";
import { logEvent } from "./logger";
import { recordApiUsage } from "./usage";
import {
  STORY_SECTIONS,
  buildMainEditionPrompt,
  LENGTH_RULES,
  buildSystemPrompt,
  formatRecentCoverage,
  type RawEdition
} from "./groq";

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** Gemini returns 429/5xx under load ("model is experiencing high demand"). */
const TRANSIENT_STATUS = /Gemini API error: (429|5\d\d)\b/;

/** "High demand" 503s often clear within seconds; a second, longer wait catches more of them. */
const RETRY_DELAYS_MS = [5_000, 15_000];

interface GeminiOptions {
  /** System instruction; defaults to the newsroom prompt used for editions. */
  system?: string;
  /** Ask for a JSON response (default true). */
  json?: boolean;
  /** Model to use instead of GEMINI_MODEL. */
  model?: string;
}

async function generateGeminiResponse(prompt: string, maxTokens: number, options: GeminiOptions = {}): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestGemini(prompt, maxTokens, options);
    } catch (error) {
      const delayMs = RETRY_DELAYS_MS[attempt];
      if (delayMs === undefined || !(error instanceof Error) || !TRANSIENT_STATUS.test(error.message)) throw error;
      logEvent("warn", "gemini.retry", { reason: error.message.slice(0, 120), delayMs });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function requestGemini(prompt: string, maxTokens: number, options: GeminiOptions = {}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  // The key travels in a header, never in the URL, so it cannot leak through
  // request logs or error messages that echo the URL.
  const startedAt = Date.now();
  const usageKind = options.system ? "analytics" : "generate";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${options.model ?? GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: options.system ?? buildSystemPrompt() }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.4,
          ...(options.json === false ? {} : { responseMimeType: "application/json" })
        }
      }),
      signal: AbortSignal.timeout(90_000)
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    await recordApiUsage({ provider: "gemini", model: options.model ?? GEMINI_MODEL, kind: usageKind, latencyMs: Date.now() - startedAt, ok: false });
    throw new Error(`Gemini API error: ${response.status} ${detail.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  await recordApiUsage({
    provider: "gemini",
    model: options.model ?? GEMINI_MODEL,
    kind: usageKind,
    promptTokens: data.usageMetadata?.promptTokenCount,
    completionTokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0),
    latencyMs: Date.now() - startedAt
  });
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  if (!text) {
    throw new Error("No response from Gemini API");
  }

  return text;
}

export async function generateGazetteViaGemini(
  date: string,
  searchContext: string,
  recentHeadlines: string[] = [],
  articleContext: string = searchContext
): Promise<RawEdition> {
  logEvent("warn", "generation.fallback_gemini", { date, model: GEMINI_MODEL });

  const mainRaw = await generateGeminiResponse(
    `${searchContext}\n\n${buildMainEditionPrompt(date, recentHeadlines)}`,
    4096
  );
  const mainEdition = parseModelJsonValue(mainRaw, "object") as Record<string, unknown>;
  const leadTitle = (mainEdition.headline as { title?: unknown } | undefined)?.title;

  const sectionList = STORY_SECTIONS.map(
    (section) => `- ${section.count} x ${section.category} ("${section.name}")`
  ).join("\n");

  const storiesRaw = await generateGeminiResponse(
    `${articleContext}

Write up to 12 news stories for today's edition as a JSON array of
{ "headline": string, "summary": string, "category": "AI"|"TECH"|"OPEN SOURCE"|"STARTUP"|"HARDWARE"|"SECURITY", "source": string, "url": string }

Aim for this mix:
${sectionList}

Rules:
- Every story must cover a DIFFERENT news event. Return fewer stories rather than repeating an event.
- Do not repeat the lead story: ${typeof leadTitle === "string" ? leadTitle : "(none)"}
${formatRecentCoverage(recentHeadlines)}${LENGTH_RULES}
- url: copy the exact URL of the search result you used.`,
    8192
  );

  const stories = parseModelJsonValue(storiesRaw, "array") as unknown[];

  return {
    headline: mainEdition.headline,
    stories,
    repos: mainEdition.repos,
    market_brief: mainEdition.market_brief
  };
}

/**
 * One Gemini call for the analytics dashboard (narrative, ask box). Same retry
 * and key handling as edition generation, with its own system prompt.
 */
export async function callGemini(prompt: string, options: GeminiOptions & { maxTokens?: number } = {}): Promise<string> {
  return generateGeminiResponse(prompt, options.maxTokens ?? 1024, options);
}

export function getGeminiModelName(): string {
  return GEMINI_MODEL;
}
