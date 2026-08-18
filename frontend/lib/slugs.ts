import type { Story } from "@/lib/types";

export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export function findStoryBySlug(stories: Story[], slug: string): Story | undefined {
  return stories.find((story) => generateSlug(story.headline) === slug);
}
