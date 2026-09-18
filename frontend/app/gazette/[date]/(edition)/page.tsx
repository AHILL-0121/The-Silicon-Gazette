import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditionPage } from "@/components/EditionPage";
import { PrintingPress } from "@/components/PrintingPress";
import { SiteHeader } from "@/components/SiteHeader";
import { NAV_COMMANDS } from "@/lib/commands";
import { compareEditionDate, formatDisplayDate, isValidEditionDate, toEditionDate } from "@/lib/date";
import { buildEditionView, CATEGORY_LABELS, excerpt } from "@/lib/edition-view";
import { OPEN_GRAPH_DEFAULTS, twitterCard } from "@/lib/metadata";
import { getEditionForPage, readAdjacentEditionDates, readEdition, readEditionView } from "@/lib/edition-service";
import type { EditionRecord } from "@/lib/types";

// Today's page may run the generation pipeline (stored runs took 80-215 s).
export const maxDuration = 300;

// Rendered per request so today's page can stream the press animation while
// it generates, and failures reach error.tsx (ISR would block on generation
// and swallow errors into a bare 500). Printed editions never change, so the
// data for past dates comes from the data cache, not from Neon (readEdition).
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ date: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { date } = await params;
  if (!isValidEditionDate(date)) return { title: "Edition not found" };

  // Metadata never triggers generation; it only reads what is stored.
  const loaded = await readEditionView(date).catch(() => null);
  const edition = loaded?.edition;
  const displayDate = formatDisplayDate(date);
  if (!edition && date !== toEditionDate()) return { title: "Edition not found" };
  if (!edition) {
    return {
      title: `Edition for ${displayDate}`,
      alternates: { canonical: `/gazette/${date}` }
    };
  }

  const view = loaded.view;
  const description = excerpt(`${view.lead.title}. ${view.lead.deck}`, 200);
  const socialTitle = `${displayDate}: ${view.lead.title}`;
  return {
    title: `${displayDate} edition: ${view.lead.title}`,
    description,
    alternates: { canonical: `/gazette/${date}` },
    openGraph: {
      ...OPEN_GRAPH_DEFAULTS,
      type: "article",
      title: socialTitle,
      description,
      url: `/gazette/${date}`,
      publishedTime: edition.generated_at,
      section: CATEGORY_LABELS[view.lead.category],
      // Listed explicitly: the card lives in the parent [date] folder, and a
      // page's openGraph object would otherwise replace it.
      images: [
        {
          url: `/gazette/${date}/opengraph-image`,
          width: 1200,
          height: 630,
          alt: `The Silicon Gazette, ${displayDate}: ${view.lead.title}`
        }
      ]
    },
    twitter: twitterCard(socialTitle, description, `/gazette/${date}/opengraph-image`)
  };
}

async function RenderedEdition({ edition }: { edition: EditionRecord }) {
  // Same memoised view generateMetadata used (for a freshly generated edition it is built here).
  const view = (await readEditionView(edition.date))?.view ?? buildEditionView(edition.content, edition.date);
  const adjacent = await readAdjacentEditionDates(edition.date);
  return <EditionPage edition={edition} view={view} previousDate={adjacent.previousDate} nextDate={adjacent.nextDate} />;
}

/** Today's paper hasn't been printed yet: generate it while the press animation plays. */
async function GeneratedEdition({ date }: { date: string }) {
  const edition = await getEditionForPage(date);
  return <RenderedEdition edition={edition} />;
}

export default async function GazetteDatePage({ params }: PageProps) {
  const { date } = await params;
  const today = toEditionDate();
  // Nothing is ever printed ahead of time: no need to ask the database.
  if (!isValidEditionDate(date) || compareEditionDate(date, today) > 0) notFound();

  const stored = await readEdition(date);
  if (stored) return <RenderedEdition edition={stored} />;

  // Only today's edition is ever generated. Past days without an edition and
  // future days are real 404s, not "no edition" pages served with 200.
  if (date !== today) notFound();

  return (
    <Suspense
      fallback={
        <>
          <SiteHeader entries={NAV_COMMANDS} dateline={formatDisplayDate(date)} />
          <main id="main" tabIndex={-1} className="page-x focus:outline-none">
            <PrintingPress />
          </main>
        </>
      }
    >
      <GeneratedEdition date={date} />
    </Suspense>
  );
}
