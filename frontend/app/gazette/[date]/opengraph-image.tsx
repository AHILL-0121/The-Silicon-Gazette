import { formatDisplayDate, isValidEditionDate } from "@/lib/date";
import { readEdition } from "@/lib/edition-service";
import { OG_SIZE, PRINTED_CARD_CACHE_SECONDS, renderSocialCard } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "The Silicon Gazette edition card with its date and lead headline";

export default async function Image({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const valid = isValidEditionDate(date);
  // Reads only: an image request never starts generation.
  const edition = valid ? await readEdition(date).catch(() => null) : null;
  return renderSocialCard({
    kicker: valid ? formatDisplayDate(date) : "Daily edition",
    headline: edition?.content.headline.title,
    footer: edition ? `Vol. I · No. ${edition.issue_num}` : "All the code that's fit to print",
    cacheSeconds: edition ? PRINTED_CARD_CACHE_SECONDS : 300
  });
}
