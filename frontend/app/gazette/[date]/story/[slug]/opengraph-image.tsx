import { formatDisplayDate, isValidEditionDate } from "@/lib/date";
import { buildEditionView, CATEGORY_LABELS, resolveStory } from "@/lib/edition-view";
import { readEdition } from "@/lib/edition-service";
import { OG_SIZE, PRINTED_CARD_CACHE_SECONDS, renderSocialCard } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "The Silicon Gazette story card with its headline";

export default async function Image({ params }: { params: Promise<{ date: string; slug: string }> }) {
  const { date, slug } = await params;
  const edition = isValidEditionDate(date) ? await readEdition(date).catch(() => null) : null;
  const story = edition
    ? resolveStory(buildEditionView(edition.content, date), edition.content, slug)?.story
    : undefined;
  return renderSocialCard({
    kicker: story ? `${CATEGORY_LABELS[story.category]} · ${formatDisplayDate(date)}` : "Daily edition",
    headline: story?.headline,
    footer: story ? `${story.sourceLabel} · ${story.readMinutes} min read` : "All the code that's fit to print",
    cacheSeconds: story ? PRINTED_CARD_CACHE_SECONDS : 300
  });
}
