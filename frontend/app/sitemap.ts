import type { MetadataRoute } from "next";

import { readSitemapIndex } from "@/lib/edition-service";
import { siteUrl } from "@/lib/site";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = siteUrl();
  const editions = await readSitemapIndex();

  const routes: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/archive`, changeFrequency: "daily", priority: 0.8 }
  ];

  // One entry per printed edition (today's included, exactly once) and one per
  // story page actually shown in it.
  editions.forEach((edition, index) => {
    routes.push({
      url: `${baseUrl}/gazette/${edition.date}`,
      lastModified: edition.generated_at,
      changeFrequency: index === 0 ? "daily" : "never",
      priority: index === 0 ? 1 : 0.7
    });
    for (const slug of edition.slugs) {
      routes.push({
        url: `${baseUrl}/gazette/${edition.date}/story/${slug}`,
        lastModified: edition.generated_at,
        changeFrequency: "never",
        priority: 0.5
      });
    }
  });

  return routes;
}
