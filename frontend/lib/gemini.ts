import { parseModelJsonValue } from "./gazette";
import { STORY_SECTIONS, buildMainEditionPrompt, buildSystemPrompt, type RawEdition } from "./groq";

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

async function generateGeminiResponse(prompt: string, maxTokens: number): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  // The key travels in a header, never in the URL, so it cannot leak through
  // request logs or error messages that echo the URL.
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.4,
          responseMimeType: "application/json"
        }
      }),
      signal: AbortSignal.timeout(90_000)
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${detail.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  if (!text) {
    throw new Error("No response from Gemini API");
  }

  return text;
}

export async function generateGazetteViaGemini(date: string, searchContext: string): Promise<RawEdition> {
  console.log("Switching to Gemini API as fallback...");

  const mainRaw = await generateGeminiResponse(`${searchContext}\n\n${buildMainEditionPrompt(date)}`, 4096);
  const mainEdition = parseModelJsonValue(mainRaw, "object") as Record<string, unknown>;
  const leadTitle = (mainEdition.headline as { title?: unknown } | undefined)?.title;

  const sectionList = STORY_SECTIONS.map(
    (section) => `- ${section.count} x ${section.category} ("${section.name}")`
  ).join("\n");

  const storiesRaw = await generateGeminiResponse(
    `${searchContext}

Write up to 12 news stories for today's edition as a JSON array of
{ "headline": string, "summary": string, "category": "AI"|"TECH"|"OPEN SOURCE"|"STARTUP"|"HARDWARE"|"SECURITY", "source": string, "url": string }

Aim for this mix:
${sectionList}

Rules:
- Every story must cover a DIFFERENT news event. Return fewer stories rather than repeating an event.
- Do not repeat the lead story: ${typeof leadTitle === "string" ? leadTitle : "(none)"}
- summary: 2-3 paragraphs separated by \\n\\n, 150-250 words.
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

export function getGeminiModelName(): string {
  return GEMINI_MODEL;
}
