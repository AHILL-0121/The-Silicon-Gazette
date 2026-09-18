import { z } from "zod";

export const CategoryEnum = z.enum([
  "AI",
  "TECH",
  "OPEN SOURCE",
  "STARTUP",
  "HARDWARE",
  "SECURITY"
]);

// The SRS asks for at least 4 secondary stories; up to 12 are generated.
export const MIN_STORIES = 4;
export const MAX_STORIES = 12;
// Five repos are requested; an edition with a few unusable ones is still published.
export const REPO_COUNT = 5;
export const MIN_REPOS = 3;

const httpUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "Only http(s) URLs are allowed");

const StorySchema = z.object({
  headline: z.string().min(3).max(160),
  summary: z.string().min(50).max(4000),
  category: CategoryEnum,
  source: z.string().min(2),
  url: httpUrl.optional()
});

const RepoSchema = z.object({
  name: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  description: z.string().min(5).max(200),
  stars: z.string().min(1),
  language: z.string().min(1)
});

export const GazetteEditionSchema = z.object({
  headline: z.object({
    title: z.string().min(10).max(160),
    deck: z.string().min(20).max(300),
    body: z.string().min(100),
    category: CategoryEnum,
    source: z.string().min(2),
    url: httpUrl.optional()
  }),
  stories: z.array(StorySchema).min(MIN_STORIES).max(MAX_STORIES),
  repos: z.array(RepoSchema).min(MIN_REPOS).max(REPO_COUNT),
  market_brief: z.string().min(10).max(300)
});

export type GazetteEdition = z.infer<typeof GazetteEditionSchema>;

const VALID_CATEGORIES = new Set<string>(CategoryEnum.options);

function textValue(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) {
    return fallback;
  }
  // Models sometimes return "" for fields they couldn't fill: use the fallback.
  return String(value).trim() || fallback;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

function normalizeCategory(value: unknown): z.infer<typeof CategoryEnum> {
  const maybe = textValue(value).toUpperCase();
  if (VALID_CATEGORIES.has(maybe)) {
    return maybe as z.infer<typeof CategoryEnum>;
  }
  return "TECH";
}

/**
 * Returns the URL only when it is an absolute http(s) URL. Anything else
 * (javascript:, data:, relative paths, garbage) is dropped so it can never be
 * rendered as a link.
 */
export function safeHttpUrl(value: unknown): string | undefined {
  const raw = textValue(value);
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function normalizeSourceUrl(value: unknown, allowedUrls?: Set<string>): string | undefined {
  const url = safeHttpUrl(value);
  if (!url) return undefined;
  // When we know which URLs the search step returned, only keep links the
  // model copied from them. This blocks hallucinated or injected links.
  if (allowedUrls && allowedUrls.size > 0 && !allowedUrls.has(url)) {
    return undefined;
  }
  return url;
}

function normalizeRepoName(value: unknown): string | null {
  const raw = textValue(value);
  if (!raw) return null;

  const githubUrlMatch = raw.match(/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)/i);
  if (githubUrlMatch) {
    return `${githubUrlMatch[1]}/${githubUrlMatch[2]}`;
  }

  const slashMatch = raw.match(/([A-Za-z0-9._-]+)\s*\/\s*([A-Za-z0-9._-]+)/);
  if (slashMatch) {
    return `${slashMatch[1]}/${slashMatch[2]}`;
  }

  return null;
}

const UNKNOWN_VALUES = /^(n\/?a|none|null|unknown|not specified|unspecified|-+|—)$/i;

function normalizeStars(value: unknown): string {
  const raw = textValue(value);
  if (!raw || UNKNOWN_VALUES.test(raw)) return "—";
  return truncate(raw, 32);
}

function normalizeLanguage(value: unknown): string {
  const raw = textValue(value);
  if (!raw || UNKNOWN_VALUES.test(raw)) return "Unknown";
  return truncate(raw, 40);
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "into", "after", "from", "that", "this", "its", "over", "amid",
  "new", "how", "why", "what", "will", "has", "have", "are", "was", "about", "across", "under"
]);

function headlineTokens(headline: string): Set<string> {
  return new Set(
    headline
      .toLowerCase()
      .replace(/[’']s\b/g, "")
      .split(/[^a-z0-9.$]+/)
      .map((token) => token.replace(/^\.+|\.+$/g, ""))
      .filter((token) => (token.length > 2 || /\d/.test(token)) && !STOP_WORDS.has(token))
  );
}

function bodyTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[’']s\b/g, "")
      .split(/[^a-z0-9$]+/)
      .filter((token) => token.length > 3 || /\d/.test(token))
  );
}

function sharedCount(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  return shared;
}

type Comparable = { headline: string; summary?: string };

/**
 * Two stories are treated as the same news event when their headlines share
 * most distinctive words. Headline wording alone is ambiguous for short
 * templated titles ("X Releases Y With Longer Context"), so when summaries are
 * available they must also overlap. Thresholds were tuned against the
 * duplicated editions stored for 2026-09-13 and 2026-09-14.
 */
export function isSameStory(a: Comparable, b: Comparable): boolean {
  const ta = headlineTokens(a.headline);
  const tb = headlineTokens(b.headline);
  if (ta.size === 0 || tb.size === 0) {
    return a.headline.trim().toLowerCase() === b.headline.trim().toLowerCase();
  }
  const shared = sharedCount(ta, tb);
  const overlap = shared / Math.min(ta.size, tb.size);

  if (a.summary && b.summary) {
    if (overlap < 0.5 && !(shared >= 5 && overlap >= 0.45)) return false;
    const sa = bodyTokens(a.summary);
    const sb = bodyTokens(b.summary);
    const common = sharedCount(sa, sb);
    const jaccard = common / (sa.size + sb.size - common || 1);
    return jaccard >= 0.18 || overlap >= 0.85;
  }

  return overlap >= 0.75;
}

/**
 * Removes stories that repeat an earlier story (or the lead) while keeping at
 * least `minimum` stories so a page is never left empty.
 */
export function dedupeStories<T extends Comparable>(
  stories: T[],
  lead?: Comparable,
  minimum = MIN_STORIES
): T[] {
  const unique: T[] = [];
  for (const story of stories) {
    if (!unique.some((kept) => isSameStory(kept, story))) {
      unique.push(story);
    }
  }

  if (!lead) return unique;
  const withoutLead = unique.filter((story) => !isSameStory(story, lead));
  return withoutLead.length >= minimum ? withoutLead : unique;
}

export function normalizeEditionCandidate(
  input: unknown,
  options: { allowedUrls?: Set<string> } = {}
): unknown {
  const payload = (input ?? {}) as Record<string, unknown>;
  const rawHeadline = (payload.headline ?? {}) as Record<string, unknown>;
  const rawStories = Array.isArray(payload.stories) ? payload.stories : [];
  const rawRepos = Array.isArray(payload.repos) ? payload.repos : [];

  const headlineTitle = truncate(textValue(rawHeadline.title), 160);
  const headlineBody = textValue(rawHeadline.body);

  const stories = rawStories
    .map((story) => {
      const row = (story ?? {}) as Record<string, unknown>;
      return {
        headline: truncate(textValue(row.headline), 160),
        summary: truncate(textValue(row.summary), 4000),
        category: normalizeCategory(row.category),
        source: truncate(textValue(row.source, "Newswire"), 80),
        url: normalizeSourceUrl(row.url, options.allowedUrls)
      };
    })
    // Empty model output is dropped instead of being padded with filler copy.
    .filter((story) => story.headline.length >= 3 && story.summary.length >= 50);

  const repos: Array<{ name: string; description: string; stars: string; language: string }> = [];
  for (const repo of rawRepos) {
    const row = (repo ?? {}) as Record<string, unknown>;
    const name = normalizeRepoName(row.name);
    if (!name || repos.some((existing) => existing.name.toLowerCase() === name.toLowerCase())) {
      continue;
    }
    repos.push({
      name,
      description: truncate(textValue(row.description, "Repository gaining attention on GitHub."), 200),
      stars: normalizeStars(row.stars),
      language: normalizeLanguage(row.language)
    });
  }

  return {
    headline: {
      title: headlineTitle,
      deck: truncate(textValue(rawHeadline.deck), 300),
      body: headlineBody,
      category: normalizeCategory(rawHeadline.category),
      source: truncate(textValue(rawHeadline.source, "Newswire"), 80),
      url: normalizeSourceUrl(rawHeadline.url, options.allowedUrls)
    },
    stories: dedupeStories(stories, { headline: headlineTitle, summary: headlineBody }).slice(0, MAX_STORIES),
    repos: repos.slice(0, REPO_COUNT),
    market_brief: truncate(textValue(payload.market_brief), 300)
  };
}

/**
 * Normalizes raw model output and validates it against the edition schema.
 * Throws a ZodError when the edition is not publishable.
 */
export function normalizeEdition(input: unknown, options: { allowedUrls?: Set<string> } = {}): GazetteEdition {
  return GazetteEditionSchema.parse(normalizeEditionCandidate(input, options));
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

export function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("429") || message.includes("rate_limit_exceeded");
}
