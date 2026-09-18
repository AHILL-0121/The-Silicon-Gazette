import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArchiveControls } from "@/components/ArchiveControls";
import { ArchiveLedger } from "@/components/ArchiveLedger";
import type { CommandEntry } from "@/components/CommandPalette";
import { ScrollReveal } from "@/components/Interactions";
import { MotionDirector } from "@/components/MotionDirector";
import { Pagination } from "@/components/Pagination";
import { RiseText } from "@/components/RiseText";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { JsonLd } from "@/components/JsonLd";
import { archiveHref } from "@/lib/archive-url";
import { OPEN_GRAPH_DEFAULTS, twitterCard } from "@/lib/metadata";
import { archiveGraph } from "@/lib/structured-data";
import { NAV_COMMANDS } from "@/lib/commands";
import { formatDisplayDate } from "@/lib/date";
import { CATEGORY_LABELS } from "@/lib/edition-view";
import { ARCHIVE_PAGE_SIZE, readArchivePage } from "@/lib/edition-service";
import { CategoryEnum } from "@/lib/gazette";
import type { Category } from "@/lib/types";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function parseParams(raw: Record<string, string | string[] | undefined>) {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const pageText = first(raw.page);
  const page = pageText === undefined ? 1 : Number(pageText);
  const q = first(raw.q)?.trim().slice(0, 100) || undefined;
  const categoryText = first(raw.category)?.toUpperCase();
  const category = CategoryEnum.safeParse(categoryText).success ? (categoryText as Category) : undefined;
  return { page, q, category, validPage: Number.isInteger(page) && page >= 1 };
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const { page, q, category, validPage } = parseParams(await searchParams);
  const filtered = Boolean(q || category);
  const parts = [q && `“${q}”`, category && CATEGORY_LABELS[category], validPage && page > 1 && `page ${page}`].filter(Boolean);
  const title = parts.length ? `Archive: ${parts.join(", ")}` : "Archive";
  const description = "Every edition of The Silicon Gazette, searchable by headline, company and date.";
  return {
    title,
    description,
    alternates: { canonical: filtered ? "/archive" : archiveHref({ page }) },
    openGraph: {
      ...OPEN_GRAPH_DEFAULTS,
      type: "website",
      title: `${title} · The Silicon Gazette`,
      description,
      url: "/archive"
    },
    twitter: twitterCard(`${title} · The Silicon Gazette`, description, "/archive/opengraph-image"),
    // Search and filter results are for readers, not for the index.
    robots: filtered ? { index: false, follow: true } : undefined
  };
}

export default async function ArchivePage({ searchParams }: { searchParams: SearchParams }) {
  const { page, q, category, validPage } = parseParams(await searchParams);
  if (!validPage) notFound();

  const result = await readArchivePage({ page, q, category });
  const totalPages = Math.max(1, Math.ceil(result.total / ARCHIVE_PAGE_SIZE));
  if (page > totalPages) notFound();

  const allCount = result.categories.reduce((sum, item) => sum + item.count, 0);
  const chips = [...result.categories]
    .sort((a, b) => b.count - a.count)
    .map((item) => ({ value: item.category, label: CATEGORY_LABELS[item.category] ?? item.category, count: item.count }));

  const from = result.total === 0 ? 0 : (page - 1) * ARCHIVE_PAGE_SIZE + 1;
  const to = Math.min(page * ARCHIVE_PAGE_SIZE, result.total);
  const noun = result.total === 1 ? "edition" : "editions";
  const summary =
    result.total === 0
      ? "No editions"
      : totalPages > 1
        ? `${from}–${to} of ${result.total} ${noun}`
        : `${result.total} ${noun}`;

  const commands: CommandEntry[] = [
    ...result.items.map((edition) => ({
      id: `edition-${edition.date}`,
      label: formatDisplayDate(edition.date),
      hint: edition.title,
      href: `/gazette/${edition.date}`,
      group: "Editions" as const
    })),
    ...NAV_COMMANDS
  ];

  const filtered = Boolean(q || category);

  return (
    <>
      <SiteHeader entries={commands} />
      <main id="main" tabIndex={-1} className="page-x focus:outline-none">
        {!filtered && page === 1 && <JsonLd data={archiveGraph(result.total)} />}
        <header className="grid gap-6 pb-10 pt-12 sm:pt-16 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="label">The Silicon Gazette · Vol. I</p>
            <h1 aria-label="The Archive" className="mt-4 font-display text-[clamp(3.5rem,11vw,9rem)] leading-[0.85] tracking-[-0.02em]">
              <RiseText text="The" />{" "}
              <em className="text-signal">
                <RiseText text="Archive" startIndex={1} baseDelayMs={60} />
              </em>
            </h1>
          </div>
          <p className="max-w-sm font-serif text-xl italic text-ink-soft md:text-right">
            Every edition the paper has printed. Search any headline, company or date.
          </p>
        </header>

        <ArchiveControls q={q ?? ""} category={category ?? null} chips={chips} allCount={allCount} summary={summary}>
          {result.items.length === 0 ? (
            <div className="py-24 text-center">
              <p className="font-serif text-xl italic text-muted">
                {filtered ? "No editions match that search." : "No editions have been printed yet."}
              </p>
              {filtered && (
                <Link href="/archive" className="btn mt-6">
                  Clear search
                </Link>
              )}
            </div>
          ) : (
            <ArchiveLedger editions={result.items} />
          )}
          <Pagination
            page={page}
            totalPages={totalPages}
            href={(target) => archiveHref({ q, category, page: target })}
            label="Archive pages"
          />
        </ArchiveControls>
        {/* Re-armed for every page or search so new rows animate in and none stay hidden. */}
        <ScrollReveal key={`${page}|${q ?? ""}|${category ?? ""}`} />
        <MotionDirector />
      </main>
      <SiteFooter />
    </>
  );
}
