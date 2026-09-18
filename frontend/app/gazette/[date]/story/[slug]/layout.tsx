import { notFound, permanentRedirect } from "next/navigation";
import type { ReactNode } from "react";

import { lookupStory } from "@/lib/story-lookup";

/**
 * Decides 404s and redirects before the loading skeleton starts streaming.
 * A notFound() inside the page would arrive after a 200 status was already
 * sent (a "soft 404"); from the layout the response is a real 404 or 308.
 */
export default async function StoryLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ date: string; slug: string }>;
}) {
  const { date, slug } = await params;
  // A database failure is left to the page, which renders it inside error.tsx.
  const result = await lookupStory(date, slug).catch(() => null);
  if (result?.kind === "not-found") notFound();
  if (result?.kind === "redirect") permanentRedirect(result.to);
  return children;
}
