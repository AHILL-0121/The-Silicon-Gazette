import { MIN_STORIES } from "./gazette";
import { foldText, hostOf, type EvidenceEntry } from "./evidence";
import type { GazetteEdition, Repo, Story } from "./types";

/**
 * Deterministic fact check of a generated edition against the search results
 * the models were given. Nothing here calls a model: every rule compares model
 * output with source text, so the checks cannot hallucinate themselves.
 *
 * What it enforces:
 *  - every story cites one article result (no aggregators, no URL = no story)
 *  - no two stories share a source, and a source used in the past week is skipped
 *  - the headline overlaps its source and its numbers appear in the source
 *    (otherwise the source's own title is used)
 *  - summary sentences survive only if their numbers, proper nouns and wording
 *    are found in the source text (commentary and invented detail are cut)
 *  - repos must be named in the results; stars/description/language are kept
 *    only when the source shows them
 *  - the source label matches the URL
 *
 * What it cannot catch: a claim built entirely from words that are in the
 * source but combined wrongly (two people swapped, a cause reversed).
 */

export class GroundingError extends Error {}

export interface GroundingReport {
  droppedStories: Array<{ headline: string; reason: string }>;
  trimmedSentences: number;
  fallbackSummaries: number;
  headlinesReplaced: number;
  repoFixes: string[];
  droppedRepos: string[];
  sourceRelabeled: number;
  marketBriefReplaced: boolean;
}

/** Share of a headline's content words that must appear in its source. */
const MIN_HEADLINE_OVERLAP = 0.6;
/** Share of a sentence's content words that must appear in its source. */
const MIN_SENTENCE_OVERLAP = 0.5;

const STOP = new Set(
  (
    "the and for with into after from that this its over amid new how why what will has have are was were about across under " +
    "their there which while when where been being also than then they them these those more most some such into onto upon " +
    "said says say could would should may might can just very much many other another each both only own same than too"
  ).split(" ")
);

/** Capitalised words that carry no claim. */
const GENERIC_CAPS = new Set(
  (
    "january february march april may june july august september october november december " +
    "monday tuesday wednesday thursday friday saturday sunday " +
    "ai ml us uk eu un ceo cto cfo coo ipo api gpu cpu llm llms saas the a an in on at as of to by"
  ).split(" ")
);

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}.'\-]*/gu;

function normalizeToken(raw: string): string {
  let word = raw.toLowerCase().replace(/'s$/, "").replace(/[.'\-]+$/g, "");
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) word = word.slice(0, -1);
  return word;
}

/** Splits "Imperva-Thales" / "node.js" into comparable parts. */
function tokenParts(raw: string): string[] {
  return foldText(raw)
    .split(/[-.]/)
    .map(normalizeToken)
    .filter((part) => part.length >= 2);
}

class EvidenceText {
  readonly tokens = new Set<string>();
  readonly prefixes = new Set<string>();
  readonly numbers: ParsedNumber[];

  constructor(readonly text: string) {
    const folded = foldText(text);
    for (const match of folded.matchAll(WORD_RE)) {
      for (const part of tokenParts(match[0])) {
        this.tokens.add(part);
        if (part.length >= 6) this.prefixes.add(part.slice(0, 5));
      }
    }
    this.numbers = extractNumbers(folded);
  }

  /** Exact word, or (for long words) a shared 5-letter stem: Israel/Israeli. */
  has(token: string): boolean {
    if (this.tokens.has(token)) return true;
    return token.length >= 6 && this.prefixes.has(token.slice(0, 5));
  }

  supportsNumber(target: ParsedNumber): boolean {
    return this.numbers.some((candidate) => numbersMatch(target, candidate));
  }
}

/* -------------------------------------------------------------------------- */
/* Numbers                                                                     */
/* -------------------------------------------------------------------------- */

export interface ParsedNumber {
  value: number;
  percent: boolean;
  /** Written with a unit ($, %, k, million…) or large enough to be a claim. */
  significant: boolean;
  raw: string;
}

const SCALES: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
  trillion: 1e12,
  crore: 1e7,
  lakh: 1e5
};

const NUMBER_RE =
  /(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?(%|percent|per cent|thousand|million|billion|trillion|crore|lakh|bn|[kmb](?![\p{L}\p{N}]))?/giu;

export function extractNumbers(text: string): ParsedNumber[] {
  const found: ParsedNumber[] = [];
  for (const match of foldText(text).matchAll(NUMBER_RE)) {
    const start = match.index ?? 0;
    // Digits glued to a letter on the left are part of an identifier (a1b2).
    if (start > 0 && /\p{L}/u.test(text[start - 1] ?? "")) continue;
    const base = Number(`${match[1].replace(/,/g, "")}${match[2] ?? ""}`);
    if (!Number.isFinite(base)) continue;
    const unit = (match[3] ?? "").toLowerCase().replace(/\s+/g, " ");
    const percent = unit === "%" || unit === "percent" || unit === "per cent";
    const scale = percent ? 1 : (SCALES[unit] ?? 1);
    const value = base * scale;
    const isYear = !unit && !match[2] && Number.isInteger(base) && base >= 1900 && base <= 2100;
    found.push({
      value,
      percent,
      significant: !isYear && (unit !== "" || base >= 100),
      raw: match[0].trim()
    });
  }
  return found;
}

export function numbersMatch(a: ParsedNumber, b: ParsedNumber): boolean {
  if (a.percent !== b.percent) return false;
  const tolerance = Math.max(a.value, b.value) >= 1000 ? 0.05 : 0.005;
  return Math.abs(a.value - b.value) <= tolerance * Math.max(a.value, b.value);
}

function unsupportedNumbers(text: string, evidence: EvidenceText): ParsedNumber[] {
  return extractNumbers(text).filter((parsed) => parsed.significant && !evidence.supportsNumber(parsed));
}

/* -------------------------------------------------------------------------- */
/* Sentences                                                                   */
/* -------------------------------------------------------------------------- */

function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?]["')\]]?)\s+(?=[\p{Lu}"“(\d])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function contentTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of foldText(text).matchAll(WORD_RE)) {
    for (const part of tokenParts(match[0])) {
      if (part.length > 3 && !STOP.has(part) && !/^\d+$/.test(part)) tokens.push(part);
    }
  }
  return tokens;
}

function overlapRatio(text: string, evidence: EvidenceText): number {
  const tokens = [...new Set(contentTokens(text))];
  if (tokens.length === 0) return 1;
  return tokens.filter((token) => evidence.has(token)).length / tokens.length;
}

/** Capitalised words past the first one: names, products, places. */
function unsupportedNames(sentence: string, evidence: EvidenceText): string[] {
  const missing: string[] = [];
  let index = 0;
  for (const match of foldText(sentence).matchAll(WORD_RE)) {
    const word = match[0];
    const first = index === 0;
    index += 1;
    if (first) continue;
    const bare = word.replace(/'s$/, "");
    const isName = /^\p{Lu}/u.test(bare) || /\p{Ll}\p{Lu}/u.test(bare);
    if (!isName || GENERIC_CAPS.has(bare.toLowerCase())) continue;
    const parts = tokenParts(bare).filter((part) => !/^\d+$/.test(part) && (part.length >= 3 || /^[A-Z]+$/.test(bare)));
    if (parts.length === 0) continue;
    if (!parts.every((part) => evidence.has(part))) missing.push(bare);
  }
  return missing;
}

function sentenceIsSupported(sentence: string, evidence: EvidenceText): boolean {
  if (unsupportedNumbers(sentence, evidence).length > 0) return false;
  if (unsupportedNames(sentence, evidence).length > 0) return false;
  return overlapRatio(sentence, evidence) >= MIN_SENTENCE_OVERLAP;
}

interface Filtered {
  text: string;
  removed: number;
}

/** Keeps only the sentences the evidence supports, preserving paragraph breaks. */
function keepSupportedSentences(text: string, evidence: EvidenceText): Filtered {
  let removed = 0;
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) =>
      splitSentences(paragraph.replace(/\s+/g, " "))
        .filter((sentence) => {
          const ok = sentenceIsSupported(sentence, evidence);
          if (!ok) removed += 1;
          return ok;
        })
        .join(" ")
    )
    .filter(Boolean);
  return { text: paragraphs.join("\n\n"), removed };
}

/** Page title without "[2026]" tags or a trailing " | Site Name". */
export function sourceTitle(entry: EvidenceEntry): string {
  let title = foldText(entry.title).replace(/\s*\[\s*\d{4}\s*\]/g, "");
  const cut = title.search(/\s[|–—-]\s(?!.*\s[|–—-]\s)/);
  if (cut > 15 && title.length - cut <= 45) title = title.slice(0, cut);
  return title.replace(/\s+/g, " ").trim().slice(0, 160);
}

/**
 * Text taken verbatim from the source, so it is always grounded: complete
 * snippet sentences, preceded by the page title when the snippet alone is short.
 */
function extractiveSummary(entry: EvidenceEntry, minLength: number): string {
  const sentences = splitSentences(entry.snippet).filter((sentence) => /[.!?"')\]]$/.test(sentence));
  const picked: string[] = [];
  for (const sentence of sentences) {
    picked.push(sentence);
    if (picked.join(" ").length >= minLength) break;
  }
  let text = picked.join(" ");
  if (text.length < minLength) {
    const title = sourceTitle(entry);
    text = [/[.!?]$/.test(title) ? title : `${title}.`, text].filter(Boolean).join(" ");
  }
  return text;
}

/** Model prose first, topped up with verbatim snippet sentences when too short. */
function groundedProse(
  text: string,
  entry: EvidenceEntry,
  evidence: EvidenceText,
  minLength: number,
  report: GroundingReport
): string | null {
  const filtered = keepSupportedSentences(text, evidence);
  report.trimmedSentences += filtered.removed;
  if (filtered.text.length >= minLength) return filtered.text;
  const extract = extractiveSummary(entry, minLength);
  const combined = [filtered.text, extract].filter(Boolean).join(filtered.text ? "\n\n" : "");
  if (combined.length >= minLength) {
    report.fallbackSummaries += 1;
    return combined;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Headline, source label                                                      */
/* -------------------------------------------------------------------------- */

function headlineProblem(headline: string, evidence: EvidenceText): string | null {
  const missing = unsupportedNumbers(headline, evidence);
  if (missing.length) return `number not in source: ${missing.map((n) => n.raw).join(", ")}`;
  const overlap = overlapRatio(headline, evidence);
  if (overlap < MIN_HEADLINE_OVERLAP) return `headline does not match source (${Math.round(overlap * 100)}% overlap)`;
  return null;
}

const alnum = (value: string) => foldText(value).toLowerCase().replace(/[^a-z0-9]/g, "");

/** Keeps the model's source name only if the cited page really carries it. */
function sourceLabel(claimed: string, entry: EvidenceEntry): { label: string; changed: boolean } {
  const wanted = alnum(claimed);
  const host = hostOf(entry.url);
  const hostLabel = alnum(host.split(".").slice(-2, -1)[0] ?? host);
  const plausible =
    wanted.length >= 3 && (alnum(entry.title).includes(wanted) || hostLabel.includes(wanted) || wanted.includes(hostLabel));
  return plausible ? { label: claimed, changed: false } : { label: host || "Source", changed: true };
}

/* -------------------------------------------------------------------------- */
/* Repos                                                                       */
/* -------------------------------------------------------------------------- */

const NO_REPO_DESCRIPTION = "Trending on GitHub; the source gives no description.";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Text around each mention of `name` ("owner/repo", GitHub also writes "owner / repo"). */
function repoWindow(name: string, haystack: string): string | null {
  const [owner, repo] = name.split("/");
  const pattern = new RegExp(`${escapeRegExp(owner)}\\s*/\\s*${escapeRegExp(repo)}`, "gi");
  const windows: string[] = [];
  for (const match of haystack.matchAll(pattern)) {
    const at = match.index ?? 0;
    windows.push(haystack.slice(Math.max(0, at - 60), at + match[0].length + 520));
  }
  return windows.length ? windows.join(" … ") : null;
}

function groundRepo(repo: Repo, haystack: string, report: GroundingReport): Repo | null {
  const window = repoWindow(repo.name, haystack);
  if (!window) {
    report.droppedRepos.push(`${repo.name} (not in search results)`);
    return null;
  }
  const evidence = new EvidenceText(window);
  const fixed = { ...repo };

  if (fixed.stars !== "—") {
    const claimed = extractNumbers(fixed.stars)[0];
    if (!claimed || !evidence.supportsNumber(claimed)) {
      report.repoFixes.push(`${repo.name}: stars "${repo.stars}" not in source`);
      fixed.stars = "—";
    }
  }
  if (!sentenceIsSupported(fixed.description, evidence)) {
    report.repoFixes.push(`${repo.name}: description not in source`);
    fixed.description = NO_REPO_DESCRIPTION;
  }
  // Substring match: tokenisation drops the symbols in "C++" and "C#".
  if (fixed.language !== "Unknown" && !window.toLowerCase().includes(fixed.language.toLowerCase())) {
    report.repoFixes.push(`${repo.name}: language "${repo.language}" not in source`);
    fixed.language = "Unknown";
  }
  return fixed;
}

/* -------------------------------------------------------------------------- */
/* Edition                                                                     */
/* -------------------------------------------------------------------------- */

export const NO_MARKET_BRIEF = "No market-moving figures were confirmed in today's sources.";

export function emptyReport(): GroundingReport {
  return {
    droppedStories: [],
    trimmedSentences: 0,
    fallbackSummaries: 0,
    headlinesReplaced: 0,
    repoFixes: [],
    droppedRepos: [],
    sourceRelabeled: 0,
    marketBriefReplaced: false
  };
}

export interface GroundingOptions {
  /** URLs cited by editions of the past week; reused sources are skipped. */
  recentUrls?: Set<string>;
}

/**
 * Returns the edition with every unsupported claim removed. Throws
 * GroundingError when the lead itself cannot be grounded.
 */
export function groundEdition(
  candidate: GazetteEdition,
  index: Map<string, EvidenceEntry>,
  options: GroundingOptions = {}
): { edition: GazetteEdition; report: GroundingReport } {
  const report = emptyReport();
  const used = new Set<string>();

  /* Lead ------------------------------------------------------------------ */
  const lead = candidate.headline;
  const leadEntry = lead.url ? index.get(lead.url) : undefined;
  if (!leadEntry) throw new GroundingError("Lead story cites no URL from the search results.");
  if (leadEntry.kind !== "article") throw new GroundingError(`Lead story cites a listing page (${hostOf(leadEntry.url)}), not an article.`);
  const leadEvidence = new EvidenceText(leadEntry.text);
  // A headline the source does not support is swapped for the source's own title.
  let leadTitle = lead.title;
  if (headlineProblem(lead.title, leadEvidence)) {
    leadTitle = sourceTitle(leadEntry);
    report.headlinesReplaced += 1;
  }
  if (leadTitle.length < 10) throw new GroundingError("Lead story has no usable title in its source.");
  const leadBody = groundedProse(lead.body, leadEntry, leadEvidence, 100, report);
  if (!leadBody) throw new GroundingError("Lead story has too little supported text to publish.");
  const leadDeckFiltered = keepSupportedSentences(lead.deck, leadEvidence);
  report.trimmedSentences += leadDeckFiltered.removed;
  const leadSource = sourceLabel(lead.source, leadEntry);
  if (leadSource.changed) report.sourceRelabeled += 1;
  used.add(leadEntry.url);

  /* Stories --------------------------------------------------------------- */
  const stories: Story[] = [];
  const skippedForRepeat: Story[] = [];
  for (const story of candidate.stories) {
    const drop = (reason: string) => report.droppedStories.push({ headline: story.headline, reason });
    const entry = story.url ? index.get(story.url) : undefined;
    if (!entry) {
      drop("no URL from the search results");
      continue;
    }
    if (entry.kind !== "article") {
      drop(`cites a listing page (${hostOf(entry.url)})`);
      continue;
    }
    if (used.has(entry.url)) {
      drop("source already used by another story");
      continue;
    }
    const evidence = new EvidenceText(entry.text);
    let headline = story.headline;
    if (headlineProblem(headline, evidence)) {
      headline = sourceTitle(entry);
      report.headlinesReplaced += 1;
    }
    if (headline.length < 3) {
      drop("source has no usable title");
      continue;
    }
    const summary = groundedProse(story.summary, entry, evidence, 50, report);
    if (!summary) {
      drop("no supported summary text");
      continue;
    }
    const label = sourceLabel(story.source, entry);
    if (label.changed) report.sourceRelabeled += 1;
    used.add(entry.url);
    const grounded: Story = { ...story, headline, summary, source: label.label };
    if (options.recentUrls?.has(entry.url)) skippedForRepeat.push(grounded);
    else stories.push(grounded);
  }
  // A source from earlier this week is only skipped while enough stories remain.
  for (const story of skippedForRepeat) {
    if (stories.length >= MIN_STORIES) {
      report.droppedStories.push({ headline: story.headline, reason: "source already used in the past week" });
    } else {
      stories.push(story);
    }
  }

  /* Repos ----------------------------------------------------------------- */
  const haystack = foldText([...index.values()].map((entry) => entry.text).join(" \n "));
  const repos = candidate.repos
    .map((repo) => groundRepo(repo, haystack, report))
    .filter((repo): repo is Repo => repo !== null);

  /* Market brief ---------------------------------------------------------- */
  const everything = new EvidenceText(haystack);
  const brief = keepSupportedSentences(candidate.market_brief, everything);
  const marketBrief = brief.text.length >= 10 ? brief.text : NO_MARKET_BRIEF;
  report.marketBriefReplaced = marketBrief === NO_MARKET_BRIEF;

  return {
    edition: {
      headline: {
        ...lead,
        title: leadTitle,
        deck: leadDeckFiltered.text.length >= 20 ? leadDeckFiltered.text : leadTitle.length >= 20 ? leadTitle : leadEntry.title,
        body: leadBody,
        source: leadSource.label
      },
      stories,
      repos,
      market_brief: marketBrief
    },
    report
  };
}
