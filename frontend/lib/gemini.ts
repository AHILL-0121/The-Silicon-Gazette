import { parseModelJsonValue } from "./gazette";
import type { Category, GazetteEdition, Story } from "./types";

const GEMINI_MODEL = "gemini-3.6-flash";

const VALID_CATEGORIES: Category[] = ["AI", "TECH", "OPEN SOURCE", "STARTUP", "HARDWARE", "SECURITY"];

function normalizeCategory(value: unknown): Category {
  if (typeof value === "string" && VALID_CATEGORIES.includes(value as Category)) {
    return value as Category;
  }
  return "TECH";
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateGeminiResponse(prompt: string, maxTokens: number = 1000): Promise<string> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.4
      }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Gemini API error: ${response.status} ${JSON.stringify(error)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("No response from Gemini API");
  }

  return text;
}

export async function generateGazetteViaGemini(date: string, searchContext: string): Promise<GazetteEdition> {
  console.log("📰 Switching to Gemini API as fallback...");

  // Generate main edition metadata
  const mainPrompt = `Today's date: ${date}

${searchContext}

Generate the main edition metadata as a valid JSON object with this exact structure (ONLY JSON, no markdown):
{
  "headline": {
    "title": "The Silicon Gazette",
    "deck": string,
    "body": string (exactly 3 paragraphs separated by \\n\\n),
    "category": "TECH",
    "source": string
  },
  "repos": [
    { "name": "owner/repo", "description": string, "stars": string, "language": string }
  ],
  "market_brief": string (single sentence, under 220 characters)
}`;

  const mainEditionRaw = await generateGeminiResponse(mainPrompt, 800);
  const mainEdition = parseModelJsonValue(mainEditionRaw, "object") as Partial<GazetteEdition>;

  // Generate stories
  const storiesPrompt = `${searchContext}

Generate exactly 12 tech news stories as a valid JSON array (ONLY JSON, no markdown, no explanation):
[
  {
    "headline": string,
    "summary": string (2-3 detailed paragraphs with comprehensive analysis),
    "category": "AI"|"TECH"|"OPEN SOURCE"|"STARTUP"|"HARDWARE"|"SECURITY",
    "source": string
  }
]`;

  const storiesRaw = await generateGeminiResponse(storiesPrompt, 2000);
  const storiesParsed = parseModelJsonValue(storiesRaw, "array");

  if (!Array.isArray(storiesParsed)) {
    throw new Error("Stories response is not an array");
  }

  const stories: Story[] = storiesParsed.slice(0, 12).map((story: unknown) => {
    const storyObj = story as Record<string, unknown>;
    return {
      headline: String(storyObj.headline || ""),
      summary: String(storyObj.summary || ""),
      category: normalizeCategory(storyObj.category),
      source: String(storyObj.source || "Gazette Desk")
    };
  });

  // Pad if needed
  while (stories.length < 12) {
    stories.push({
      headline: `Supplementary Report ${stories.length - 11}`,
      summary: "Additional reporting on tech sector developments is being compiled by our newsroom. Key themes and implications are being analyzed as more information becomes available. We are monitoring the situation closely and will provide updates as the story develops.",
      category: "TECH",
      source: "Gazette Desk"
    });
  }

  return {
    headline: mainEdition.headline || {
      title: "The Silicon Gazette",
      deck: "Tech News and Updates",
      body: "Latest developments in technology.\n\nIndustry trends and innovations.\n\nMarket movements and insights.",
      category: "TECH",
      source: "Gazette Desk"
    },
    stories: stories.slice(0, 12),
    repos: mainEdition.repos || [],
    market_brief: mainEdition.market_brief || "Tech sector continues to evolve rapidly."
  };
}

export function getGeminiModelName(): string {
  return GEMINI_MODEL;
}
