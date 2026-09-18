import { cache } from "react";

import { isValidEditionDate } from "./date";
import { resolveStory, type EditionView, type StoryView } from "./edition-view";
import { readEditionView } from "./edition-service";
import { buildStorySlugs, legacySlug } from "./slugs";
import type { EditionRecord } from "./types";

export type StoryLookup =
  | { kind: "ok"; edition: EditionRecord; view: EditionView; story: StoryView }
  | { kind: "redirect"; to: string }
  | { kind: "not-found" };

/**
 * Resolves a story URL once per request (shared by the route's layout, page
 * and metadata). Old or duplicate slugs redirect to the canonical story; a
 * story that was merged into the lead redirects to the front page. Story
 * pages only read stored editions and never start generation.
 */
export const lookupStory = cache(async (date: string, slug: string): Promise<StoryLookup> => {
  if (!isValidEditionDate(date)) return { kind: "not-found" };
  const loaded = await readEditionView(date);
  if (!loaded) return { kind: "not-found" };

  const { edition, view } = loaded;
  const resolved = resolveStory(view, edition.content, slug);
  if (resolved) {
    return resolved.canonical
      ? { kind: "ok", edition, view, story: resolved.story }
      : { kind: "redirect", to: resolved.story.href };
  }

  const rawSlugs = buildStorySlugs(edition.content.stories.map((story) => story.headline));
  const wasPrinted = edition.content.stories.some(
    (story, index) => rawSlugs[index] === slug || legacySlug(story.headline) === slug
  );
  return wasPrinted ? { kind: "redirect", to: `/gazette/${date}#front` } : { kind: "not-found" };
});
