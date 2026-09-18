import { readArchivePage } from "@/lib/edition-service";
import { OG_SIZE, renderSocialCard } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "The Silicon Gazette archive card";

export default async function Image() {
  const total = await readArchivePage({ page: 1 })
    .then((result) => result.total)
    .catch(() => null);
  return renderSocialCard({
    kicker: "The Archive",
    headline: "Every edition the paper has printed, searchable by headline, company and date.",
    footer: total ? `${total} editions and counting` : "All the code that's fit to print",
    cacheSeconds: 3600
  });
}
