import type { MetadataRoute } from "next";

import { listArchive } from "@/lib/edition-service";
import { toEditionDate } from "@/lib/date";
import { buildStorySlugs } from "@/lib/slugs";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const entries = await listArchive();
  const today = toEditionDate();

  const routes: MetadataRoute.Sitemap = [
    // SEO-04: today's edition appears exactly once (not duplicated below)
    {
      url: `${baseUrl}/gazette/${today}`,
      changeFrequency: "daily",
      priority: 1
    },
    {
      url: `${baseUrl}/archive`,
      changeFrequency: "daily",
      priority: 0.8
    }
  ];

  for (const edition of entries) {
    // Skip today — already added above to avoid duplicate
    if (edition.date === today) continue;

    routes.push({
      url: `${baseUrl}/gazette/${edition.date}`,
      lastModified: edition.generated_at,
      changeFrequency: "never",
      priority: 0.7
    });

    // SEO-04: Add individual story URLs for crawlability
    const slugs = buildStorySlugs(edition.story_headlines);
    for (const slug of slugs) {
      routes.push({
        url: `${baseUrl}/gazette/${edition.date}/story/${slug}`,
        lastModified: edition.generated_at,
        changeFrequency: "never",
        priority: 0.5
      });
    }
  }

  return routes;
}