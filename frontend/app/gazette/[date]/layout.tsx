import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { compareEditionDate, isValidEditionDate, toEditionDate } from "@/lib/date";
import { readEdition } from "@/lib/edition-service";

/**
 * Decides whether an edition exists before the loading skeleton starts
 * streaming, so a missing, future or invalid date is a real 404 instead of a
 * 200 page carrying a "not found" message. Today's date always passes: its
 * page generates the edition if needed. Reads come from the shared cache.
 */
export default async function EditionLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const today = toEditionDate();
  if (!isValidEditionDate(date) || compareEditionDate(date, today) > 0) notFound();

  if (date !== today) {
    // A database failure is left to the page, which renders it inside error.tsx.
    const edition = await readEdition(date).catch(() => undefined);
    if (edition === null) notFound();
  }
  return children;
}
