import { dedupeStories, isSameStory, safeHttpUrl } from "./gazette";
import { buildStorySlugs, legacySlug } from "./slugs";
import type { Category, GazetteEdition, Headline, Repo, Story } from "./types";

export interface StoryView extends Story {
  slug: string;
  href: string;
  paragraphs: string[];
  /** Short plain-text teaser for cards and lists. */
  excerpt: string;
  readMinutes: number;
  /** Publication name with any pasted URLs removed. */
  sourceLabel: string;
  sourceUrl?: string;
  /** Section page this story is printed on. */
  sectionId: string;
}

export interface RepoView extends Repo {
  href: string;
  starsLabel: string | null;
  languageLabel: string | null;
}

export interface SectionView {
  id: string;
  label: string;
  kicker: string;
  categories: Category[];
  stories: StoryView[];
}

export interface EditionView {
  lead: Headline & { paragraphs: string[]; sourceUrl?: string; sourceLabel: string; readMinutes: number };
  stories: StoryView[];
  repos: RepoView[];
  sections: SectionView[];
  marketBrief: string;
  totalReadMinutes: number;
}

const SECTION_DEFS: Array<Omit<SectionView, "stories">> = [
  { id: "machine-intelligence", label: "Machine Intelligence", kicker: "Models, labs and the research frontier", categories: ["AI"] },
  { id: "tech-platforms", label: "Tech & Platforms", kicker: "Products, platforms and the hardware beneath them", categories: ["TECH", "HARDWARE"] },
  { id: "markets-funding", label: "Markets & Funding", kicker: "Capital, deals and momentum", categories: ["STARTUP"] },
  { id: "open-source", label: "Open Source", kicker: "Community releases and the repo beat", categories: ["OPEN SOURCE"] },
  { id: "security-policy", label: "Security & Policy", kicker: "Threats, privacy and governance", categories: ["SECURITY"] }
];

const WORDS_PER_MINUTE = 230;

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

export function readMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** Trims text to about `max` characters at a word boundary. */
export function excerpt(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).replace(/[,;:.\s]+$/, "")}…`;
}

/** Host name without "www.", for analytics (`source_click`); "" when unparsable. */
export function urlHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Models often paste the result URL into the source field
 * ("Reuters Technology (https://www.reuters.com/technology)"). Readers get the
 * publication name; a bare URL becomes its host name.
 */
export function cleanSourceLabel(source: string): string {
  const withoutUrls = source
    .replace(/\(\s*https?:\/\/[^)]*\)/gi, "")
    .replace(/\s+[-–—|]\s+https?:\/\/\S+/gi, "")
    .trim();
  if (/^https?:\/\//i.test(withoutUrls)) {
    try {
      return new URL(withoutUrls).hostname.replace(/^www\./, "");
    } catch {
      return "Newswire";
    }
  }
  return withoutUrls || "Newswire";
}

function toRepoView(repo: Repo): RepoView {
  const stars = repo.stars.trim();
  const language = repo.language.trim();
  return {
    ...repo,
    href: `https://github.com/${repo.name}`,
    starsLabel: stars && !/^(—|-|n\/?a|unknown)$/i.test(stars) ? stars : null,
    languageLabel: language && !/^(unknown|not specified|n\/?a)$/i.test(language) ? language : null
  };
}

/**
 * Turns stored edition content into what the UI renders: duplicate stories
 * are removed (older editions contain the same event up to four times), each
 * story gets a stable unique slug and is assigned to exactly one section.
 */
export function buildEditionView(content: GazetteEdition, date: string): EditionView {
  // Slugs are computed over the stored order so links stay stable even if the
  // de-duplication rules change later.
  const slugs = buildStorySlugs(content.stories.map((story) => story.headline));
  const withSlugs = content.stories.map((story, index) => ({ story, slug: slugs[index] }));
  const unique = dedupeStories(
    withSlugs.map((entry) => ({ ...entry, headline: entry.story.headline, summary: entry.story.summary })),
    { headline: content.headline.title, summary: content.headline.body }
  );

  const sectionFor = (category: Category) =>
    SECTION_DEFS.find((section) => section.categories.includes(category))?.id ?? SECTION_DEFS[1].id;

  const stories: StoryView[] = unique.map(({ story, slug }) => {
    const paragraphs = splitParagraphs(story.summary);
    return {
      ...story,
      slug,
      href: `/gazette/${date}/story/${slug}`,
      paragraphs,
      excerpt: excerpt(paragraphs[0] ?? story.summary),
      readMinutes: readMinutes(story.summary),
      sourceLabel: cleanSourceLabel(story.source),
      sourceUrl: safeHttpUrl(story.url),
      sectionId: sectionFor(story.category)
    };
  });

  const sections = SECTION_DEFS.map((section) => ({
    ...section,
    stories: stories.filter((story) => story.sectionId === section.id)
  })).filter((section) => section.stories.length > 0);

  const lead = content.headline;
  return {
    lead: {
      ...lead,
      paragraphs: splitParagraphs(lead.body),
      sourceUrl: safeHttpUrl(lead.url),
      sourceLabel: cleanSourceLabel(lead.source),
      readMinutes: readMinutes(lead.body)
    },
    stories,
    repos: content.repos.map(toRepoView),
    sections,
    marketBrief: content.market_brief,
    totalReadMinutes: readMinutes(
      [lead.body, ...stories.map((story) => story.summary)].join(" ")
    )
  };
}

/**
 * Finds the story a URL slug points at. Besides current slugs this accepts
 * slugs from the previous algorithm and slugs of duplicate stories that the
 * view merged away, returning the story that is now shown for them so the
 * page can redirect to its canonical URL instead of a 404.
 */
export function resolveStory(
  view: EditionView,
  content: GazetteEdition,
  slug: string
): { story: StoryView; canonical: boolean } | null {
  const direct = view.stories.find((story) => story.slug === slug);
  if (direct) return { story: direct, canonical: true };

  const slugs = buildStorySlugs(content.stories.map((story) => story.headline));
  const index = content.stories.findIndex(
    (story, i) => slugs[i] === slug || legacySlug(story.headline) === slug
  );
  if (index === -1) return null;

  const raw = content.stories[index];
  const kept =
    view.stories.find((story) => story.slug === slugs[index]) ??
    view.stories.find((story) => isSameStory(story, raw));
  return kept ? { story: kept, canonical: false } : null;
}

/**
 * Slugs of the story pages an edition shows: the same slug and duplicate
 * rules as buildEditionView, without building the whole view.
 */
export function visibleStorySlugs(
  stories: Array<{ headline: string; summary: string }>,
  lead: { headline: string; summary: string }
): string[] {
  const slugs = buildStorySlugs(stories.map((story) => story.headline));
  return dedupeStories(
    stories.map((story, index) => ({ ...story, slug: slugs[index] })),
    lead
  ).map((story) => story.slug);
}

export const CATEGORY_LABELS: Record<Category, string> = {
  AI: "AI",
  TECH: "Tech",
  "OPEN SOURCE": "Open Source",
  STARTUP: "Startups",
  HARDWARE: "Hardware",
  SECURITY: "Security"
};
