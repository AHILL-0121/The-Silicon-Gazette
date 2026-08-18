import Groq from "groq-sdk";

import { parseModelJsonValue } from "./gazette";
import type { Category, GazetteEdition, Story } from "./types";

const MODEL_NAME = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

const VALID_CATEGORIES: Category[] = ["AI", "TECH", "OPEN SOURCE", "STARTUP", "HARDWARE", "SECURITY"];

function isValidCategory(value: unknown): value is Category {
  return typeof value === "string" && VALID_CATEGORIES.includes(value as Category);
}

function normalizeCategory(value: unknown): Category {
  if (isValidCategory(value)) {
    return value;
  }
  return "TECH";
}

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

function isRateLimitError(message: string): boolean {
  return message.includes("429") || message.includes("rate_limit_exceeded");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSystemPrompt(): string {
  return `You are the editor of The Silicon Gazette, a daily broadsheet for the tech industry.
Your task is to compose today's edition using ONLY the news provided below as your source material.
Respond with a single, valid JSON object. Do not include markdown fencing or any explanatory text.`;
}

function buildSectionPrompt(sectionName: string, storyCount: number): string {
  return `Generate exactly ${storyCount} news stories for the "${sectionName}" section.
Respond with ONLY a valid JSON array of objects with this exact structure (no markdown, no explanation):
[
  {
    "headline": string,
    "summary": string,
    "category": "AI"|"TECH"|"OPEN SOURCE"|"STARTUP"|"HARDWARE"|"SECURITY",
    "source": string
  }
]

Rules:
- Each story must have headline, summary, category, and source
- Summary must be 2-3 detailed paragraphs (200-400 words) with comprehensive analysis
- Write as an editor's detailed summary, not just a headline
- Include context, implications, and background
- Category should match the section theme
- Keep prose in newspaper style`;
}

function buildMainEditionPrompt(date: string): string {
  return `Today's date: ${date}

Generate the main edition metadata as a valid JSON object with this exact structure (no markdown, no explanation):
{
  "headline": {
    "title": string,
    "deck": string,
    "body": string,
    "category": "AI"|"TECH"|"OPEN SOURCE"|"STARTUP"|"HARDWARE"|"SECURITY",
    "source": string
  },
  "repos": [
    {
      "name": string (must be owner/repo format),
      "description": string,
      "stars": string,
      "language": string
    }
  ],
  "market_brief": string (single sentence under 220 characters)
}

Rules:
- Headline body must contain exactly 3 paragraphs separated by \n\n
- Return exactly 5 repos
- Every repos[i].name MUST be exactly owner/repo format (example: facebook/react)
- market_brief is the market/tech brief for today`;
}

async function generateSection(
  searchContext: string,
  sectionName: string,
  storyCount: number
): Promise<Story[]> {
  const apiKeys = getGroqApiKeys();
  if (apiKeys.length === 0) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  let lastError: unknown;
  for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex += 1) {
    const groq = new Groq({ apiKey: apiKeys[keyIndex] });
    for (let attempt = 0; attempt <= 1; attempt += 1) {
      try {
        const userPrompt = `${searchContext}\n\n${buildSectionPrompt(sectionName, storyCount)}`;

        const completion = await groq.chat.completions.create({
          model: MODEL_NAME,
          max_tokens: 2000,
          temperature: 0.4,
          messages: [
            { role: "system", content: buildSystemPrompt() },
            {
              role: "user",
              content: userPrompt
            }
          ]
        });

        const raw = completion.choices[0]?.message?.content ?? "";
        const parsed = parseModelJsonValue(raw, "array");

        if (!Array.isArray(parsed)) {
          throw new Error("Expected array of stories");
        }

        return parsed.map((story: unknown) => {
          const storyObj = story as Record<string, unknown>;
          return {
            headline: String(storyObj.headline || ""),
            summary: String(storyObj.summary || ""),
            category: normalizeCategory(storyObj.category),
            source: String(storyObj.source || "Gazette Desk")
          };
        });
      } catch (error) {
        lastError = error;

        const message = error instanceof Error ? error.message : String(error);
        if (isRateLimitError(message)) {
          if (keyIndex < apiKeys.length - 1) {
            console.warn(`Groq rate limit hit. Switching keys (${keyIndex + 1}/${apiKeys.length}).`);
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

async function generateMainEdition(date: string, searchContext: string): Promise<Partial<GazetteEdition>> {
  const apiKeys = getGroqApiKeys();
  if (apiKeys.length === 0) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  let lastError: unknown;
  for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex += 1) {
    const groq = new Groq({ apiKey: apiKeys[keyIndex] });
    for (let attempt = 0; attempt <= 1; attempt += 1) {
      try {
        const userPrompt = `${searchContext}\n\n${buildMainEditionPrompt(date)}`;

        const completion = await groq.chat.completions.create({
          model: MODEL_NAME,
          max_tokens: 2000,
          temperature: 0.4,
          messages: [
            { role: "system", content: buildSystemPrompt() },
            {
              role: "user",
              content: userPrompt
            }
          ]
        });

        const raw = completion.choices[0]?.message?.content ?? "";
        const parsed = parseModelJsonValue(raw, "object");
        return parsed as Partial<GazetteEdition>;
      } catch (error) {
        lastError = error;

        const message = error instanceof Error ? error.message : String(error);
        if (isRateLimitError(message)) {
          if (keyIndex < apiKeys.length - 1) {
            console.warn(`Groq rate limit hit. Switching keys (${keyIndex + 1}/${apiKeys.length}).`);
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

export async function generateGazette(date: string, searchContext: string): Promise<GazetteEdition> {
  // Generate main edition metadata and repos first
  const mainEdition = await generateMainEdition(date, searchContext);

  // Generate stories for each section with separate API calls
  // This avoids hitting rate limits by spreading token usage
  const sections = [
    { name: "Tech Dispatch", count: 3 },
    { name: "Markets & Trends", count: 3 },
    { name: "Startup & Funding", count: 2 },
    { name: "Open Source", count: 1 },
    { name: "Hardware & Systems", count: 1 },
    { name: "Security & Privacy", count: 1 }
  ];

  const allStories: Story[] = [];

  // Generate stories sequentially with small delays between calls
  for (const section of sections) {
    try {
      const sectionStories = await generateSection(searchContext, section.name, section.count);
      allStories.push(...sectionStories);

      // Small delay between API calls to avoid rate limits
      if (section !== sections[sections.length - 1]) {
        await wait(200);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // If it's a rate limit, fail fast - don't try remaining sections
      if (message.includes("429") || message.includes("rate_limit_exceeded")) {
        console.error(`Rate limit hit at ${section.name} section, failing immediately`);
        throw error;
      }

      console.error(`Failed to generate ${section.name} section:`, error);
      // Add fallback stories if section generation fails for other reasons
      for (let i = 0; i < section.count; i++) {
        allStories.push({
          headline: `${section.name} Story ${i + 1}`,
          summary: "Additional reporting is being compiled for this section as our newsroom continues to monitor developments. More details are expected as the situation evolves and new information becomes available from primary sources. This story will be updated as facts emerge.",
          category: "TECH",
          source: "Gazette Desk"
        });
      }
    }
  }

  return {
    headline:
      mainEdition.headline || {
        title: "The Silicon Gazette",
        deck: "Tech News and Updates",
        body: "Latest developments in technology.\n\nIndustry trends and innovations.\n\nMarket movements and insights.",
        category: "TECH",
        source: "Gazette Desk"
      },
    stories: allStories.slice(0, 12), // Ensure exactly 12 stories
    repos: mainEdition.repos || [],
    market_brief: mainEdition.market_brief || "Markets continue to evolve in the tech sector."
  };
}

export function getGroqModelName(): string {
  return MODEL_NAME;
}