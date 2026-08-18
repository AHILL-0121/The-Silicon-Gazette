import type { MetadataRoute } from "next";

import { listArchive } from "@/lib/edition-service";
import { toEditionDate } from "@/lib/date";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const entries = await listArchive();

  const routes: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/gazette/${toEditionDate()}`,
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
    routes.push({
      url: `${baseUrl}/gazette/${edition.date}`,
      lastModified: edition.generated_at,
      changeFrequency: "weekly",
      priority: 0.7
    });
  }

  return routes;
}