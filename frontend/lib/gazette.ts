import { z } from "zod";

export const CategoryEnum = z.enum([
  "AI",
  "TECH",
  "OPEN SOURCE",
  "STARTUP",
  "HARDWARE",
  "SECURITY"
]);

const StorySchema = z.object({
  headline: z.string().min(3).max(80),
  summary: z.string().min(50).max(1500),
  category: CategoryEnum,
  source: z.string().min(2),
  url: z.string().url().optional()
});

const RepoSchema = z.object({
  name: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  description: z.string().min(5).max(200),
  stars: z.string().min(1),
  language: z.string().min(1)
});

export const GazetteEditionSchema = z.object({
  headline: z.object({
    title: z.string().min(10).max(120),
    deck: z.string().min(20).max(300),
    body: z.string().min(100),
    category: CategoryEnum,
    source: z.string().min(2),
    url: z.string().url().optional()
  }),
  stories: z.array(StorySchema).length(12),
  repos: z.array(RepoSchema).length(5),
  market_brief: z.string().min(10).max(300)
});

export type GazetteEdition = z.infer<typeof GazetteEditionSchema>;

const VALID_CATEGORIES = new Set(CategoryEnum.options);

function textValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value).trim() || fallback;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

function ensureMin(value: string, min: number, filler: string): string {
  let out = value.trim();
  while (out.length < min) {
    out = `${out} ${filler}`.trim();
  }
  return out;
}

function normalizeCategory(value: unknown): z.infer<typeof CategoryEnum> {
  const maybe = textValue(value).toUpperCase() as z.infer<typeof CategoryEnum>;
  if (VALID_CATEGORIES.has(maybe)) {
    return maybe;
  }
  return "TECH";
}

function normalizeReferenceUrl(value: unknown, fallbackQuery: string): string {
  const raw = textValue(value);
  if (raw && /^https?:\/\//i.test(raw)) {
    return raw;
  }

  const query = encodeURIComponent(fallbackQuery.trim() || "technology news");
  return `https://www.google.com/search?q=${query}`;
}

function normalizeRepoName(value: unknown, index: number): string {
  const raw = textValue(value);
  if (!raw) {
    return `unknown/repo-${index + 1}`;
  }

  const githubUrlMatch = raw.match(/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)/i);
  if (githubUrlMatch) {
    return `${githubUrlMatch[1]}/${githubUrlMatch[2]}`;
  }

  const slashMatch = raw.match(/([A-Za-z0-9._-]+)\s*\/\s*([A-Za-z0-9._-]+)/);
  if (slashMatch) {
    return `${slashMatch[1]}/${slashMatch[2]}`;
  }

  const words = raw.split(/[^A-Za-z0-9._-]+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]}/${words[1]}`;
  }

  return `unknown/repo-${index + 1}`;
}

function normalizeEditionCandidate(input: unknown): unknown {
  const payload = (input ?? {}) as Record<string, unknown>;
  const rawHeadline = (payload.headline ?? {}) as Record<string, unknown>;
  const rawStories = Array.isArray(payload.stories) ? payload.stories : [];
  const rawRepos = Array.isArray(payload.repos) ? payload.repos : [];

  const headlineTitle = ensureMin(truncate(textValue(rawHeadline.title, "Daily Tech Bulletin"), 120), 10, "edition");
  const headlineDeck = ensureMin(
    truncate(textValue(rawHeadline.deck, "A concise look at the latest technology developments."), 300),
    20,
    "update"
  );
  const headlineBody = ensureMin(
    truncate(
      textValue(
        rawHeadline.body,
        "The newsroom assembled the latest technology developments from trusted wires.\n\nKey themes include AI releases, startup momentum, and open source shifts.\n\nReaders can expect a fuller issue as additional market details arrive."
      ),
      1800
    ),
    100,
    "Additional reporting will follow."
  );

  const stories = rawStories.slice(0, 12).map((story, index) => {
    const row = (story ?? {}) as Record<string, unknown>;
    const headline = ensureMin(truncate(textValue(row.headline, `Wire Update ${index + 1}`), 80), 3, "update");
    const source = ensureMin(truncate(textValue(row.source, "Newswire"), 80), 2, "wire");
    return {
      headline,
      summary: ensureMin(
        truncate(
          textValue(
            row.summary,
            "Developments continue to evolve across the sector as teams ship updates and respond to market pressure. Additional reporting is being compiled for this section. More details are expected as the story develops."
          ),
          1500
        ),
        50,
        "More details are expected."
      ),
      category: normalizeCategory(row.category),
      source,
      url: normalizeReferenceUrl(row.url, `${headline} ${source}`)
    };
  });

  while (stories.length < 12) {
    const idx = stories.length + 1;
    stories.push({
      headline: `Wire Update ${idx}`,
      summary:
        "Developments continue to evolve across the sector as teams ship updates and respond to market pressure.",
      category: "TECH",
      source: "Newswire",
      url: normalizeReferenceUrl("", `Wire Update ${idx} technology`) 
    });
  }

  const repos = rawRepos.slice(0, 5).map((repo, index) => {
    const row = (repo ?? {}) as Record<string, unknown>;
    return {
      name: normalizeRepoName(row.name, index),
      description: ensureMin(
        truncate(textValue(row.description, "Repository activity is rising as contributors add new commits."), 200),
        5,
        "update"
      ),
      stars: ensureMin(truncate(textValue(row.stars, "0"), 32), 1, "0"),
      language: ensureMin(truncate(textValue(row.language, "Unknown"), 40), 1, "Unknown")
    };
  });

  while (repos.length < 5) {
    const idx = repos.length + 1;
    repos.push({
      name: `unknown/repo-${idx}`,
      description: "Repository activity is rising as contributors add new commits.",
      stars: "0",
      language: "Unknown"
    });
  }

  return {
    headline: {
      title: headlineTitle,
      deck: headlineDeck,
      body: headlineBody,
      category: normalizeCategory(rawHeadline.category),
      source: ensureMin(truncate(textValue(rawHeadline.source, "Newswire"), 80), 2, "wire"),
      url: normalizeReferenceUrl(rawHeadline.url, `${headlineTitle} ${textValue(rawHeadline.source, "Newswire")}`)
    },
    stories,
    repos,
    market_brief: ensureMin(
      truncate(
        textValue(
          payload.market_brief,
          "Tech sentiment is cautiously bullish as AI shipping cadence stays strong."
        ),
        300
      ),
      10,
      "outlook"
    )
  };
}

type JsonShape = "object" | "array";

function extractJsonBlock(raw: string, shape: JsonShape): string {
  const cleaned = raw.replace(/```json|```/gi, "").trim();
  const openChar = shape === "array" ? "[" : "{";
  const closeChar = shape === "array" ? "]" : "}";
  const first = cleaned.indexOf(openChar);
  const last = cleaned.lastIndexOf(closeChar);

  if (first >= 0 && last > first) {
    return cleaned.slice(first, last + 1);
  }

  return cleaned;
}

function sanitizeControlCharsInStrings(input: string): string {
  let inString = false;
  let escaped = false;
  let output = "";

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const code = input.charCodeAt(i);

    if (!inString) {
      if (char === '"') {
        inString = true;
      }
      output += char;
      continue;
    }

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      output += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = false;
      output += char;
      continue;
    }

    if (code < 0x20) {
      if (char === "\n") {
        output += "\\n";
      } else if (char === "\r") {
        output += "\\r";
      } else if (char === "\t") {
        output += "\\t";
      } else {
        output += `\\u${code.toString(16).padStart(4, "0")}`;
      }
      continue;
    }

    output += char;
  }

  return output;
}

export function parseModelJsonValue(raw: string, shape: JsonShape): unknown {
  const candidate = extractJsonBlock(raw, shape);

  const attempts = [
    candidate,
    sanitizeControlCharsInStrings(candidate),
    sanitizeControlCharsInStrings(candidate).replace(/,\s*([}\]])/g, "$1")
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (shape === "array" && !Array.isArray(parsed)) {
        throw new Error("Expected JSON array");
      }
      if (shape === "object" && (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))) {
        throw new Error("Expected JSON object");
      }
      return parsed;
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Failed to parse model JSON: ${message}`);
}

export function parseModelJson(raw: string): GazetteEdition {
  const parsed = parseModelJsonValue(raw, "object");
  const normalized = normalizeEditionCandidate(parsed);
  return GazetteEditionSchema.parse(normalized);
}