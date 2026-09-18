import type { CommandEntry } from "@/components/CommandPalette";

import { formatDisplayDate } from "./date";
import { CATEGORY_LABELS, type EditionView } from "./edition-view";

export const NAV_COMMANDS: CommandEntry[] = [
  { id: "go-today", label: "Today's edition", href: "/", group: "Go to" },
  { id: "go-latest", label: "Latest printed edition", href: "/latest", group: "Go to" },
  { id: "go-archive", label: "Archive", hint: "Every edition, searchable", href: "/archive", group: "Go to" }
];

/**
 * Palette entries for one edition. `sectionHref` turns a section id into a
 * link: a plain hash on the edition page, a full URL from a story page.
 */
export function editionCommands(
  view: EditionView,
  options: {
    sectionHref: (id: string) => string;
    previousDate?: string | null;
    nextDate?: string | null;
  }
): CommandEntry[] {
  const entries: CommandEntry[] = [
    { id: "sec-front", label: "Front page", hint: view.lead.title, href: options.sectionHref("front"), group: "Sections" },
    ...view.sections.map((section) => ({
      id: `sec-${section.id}`,
      label: section.label,
      hint: section.kicker,
      href: options.sectionHref(section.id),
      group: "Sections" as const
    })),
    { id: "sec-repos", label: "The Repo Beat", hint: "Trending repositories", href: options.sectionHref("repos"), group: "Sections" },
    ...view.stories.map((story) => ({
      id: `story-${story.slug}`,
      label: story.headline,
      hint: `${CATEGORY_LABELS[story.category]} · ${story.sourceLabel} · ${story.readMinutes} min`,
      href: story.href,
      group: "Stories" as const
    })),
    ...view.repos.map((repo) => ({
      id: `repo-${repo.name}`,
      label: repo.name,
      hint: repo.description,
      href: repo.href,
      group: "Repositories" as const
    }))
  ];

  if (options.previousDate) {
    entries.push({
      id: "edition-previous",
      label: "Previous edition",
      hint: formatDisplayDate(options.previousDate),
      href: `/gazette/${options.previousDate}`,
      group: "Editions"
    });
  }
  if (options.nextDate) {
    entries.push({
      id: "edition-next",
      label: "Next edition",
      hint: formatDisplayDate(options.nextDate),
      href: `/gazette/${options.nextDate}`,
      group: "Editions"
    });
  }

  return [...entries, ...NAV_COMMANDS];
}
