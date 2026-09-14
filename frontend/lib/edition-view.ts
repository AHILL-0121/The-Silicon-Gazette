import { dedupeStories, safeHttpUrl } from "./gazette";
import { buildStorySlugs } from "./slugs";
import type { Category, GazetteEdition, Headline, Repo, Story } from "./types";

export interface StoryView extends Story {
  slug: string;
  href: string;
  paragraphs: string[];
  readMinutes: number;
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
  lead: Headline & { paragraphs: string[]; sourceUrl?: string; readMinutes: number };
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
      readMinutes: readMinutes(story.summary),
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

export function findStoryInView(view: EditionView, slug: string): StoryView | undefined {
  return view.stories.find((story) => story.slug === slug);
}

export const CATEGORY_LABELS: Record<Category, string> = {
  AI: "AI",
  TECH: "Tech",
  "OPEN SOURCE": "Open Source",
  STARTUP: "Startups",
  HARDWARE: "Hardware",
  SECURITY: "Security"
};
