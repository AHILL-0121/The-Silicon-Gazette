export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
}

/**
 * Builds one unique slug per headline, in order. The first occurrence keeps
 * the plain slug (so previously shared links still resolve); later collisions
 * get a numeric suffix, and headlines with no Latin characters fall back to
 * `story-<n>`.
 */
export function buildStorySlugs(headlines: string[]): string[] {
  const seen = new Map<string, number>();
  return headlines.map((headline, index) => {
    const base = generateSlug(headline) || `story-${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  });
}

/**
 * Find a story by its slug from a list of Story objects.
 * Used by the story page as a backward-compat helper.
 */
export function findStoryBySlug<T extends { headline: string }>(stories: T[], slug: string): T | undefined {
  const slugs = buildStorySlugs(stories.map((s) => s.headline));
  const idx = slugs.findIndex((s) => s === slug);
  return idx >= 0 ? stories[idx] : undefined;
}
