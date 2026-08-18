import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";

import { compareEditionDate, computeIssueNumber, isValidEditionDate, toEditionDate } from "@/lib/date";
import {
  GenerationFailedError,
  NoEditionFoundError,
  getAdjacentEditionDates,
  getEditionForPage
} from "@/lib/edition-service";
import { generateSlug, findStoryBySlug } from "@/lib/slugs";
import { Masthead } from "@/components/Masthead";
import { EditionNav } from "@/components/EditionNav";
import { ErrorPress } from "@/components/ErrorPress";
import { MarketStrip } from "@/components/MarketStrip";

type PageProps = {
  params: {
    date: string;
    slug: string;
  };
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { date, slug } = params;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  if (!isValidEditionDate(date)) {
    return { title: "Story Not Found" };
  }

  return {
    title: `Story | The Silicon Gazette ${date}`,
    description: "Read the full story from The Silicon Gazette.",
    alternates: {
      canonical: `/gazette/${date}/story/${slug}`
    }
  };
}

export default async function StoryPage({ params }: PageProps) {
  const { date, slug } = params;

  if (!isValidEditionDate(date)) {
    notFound();
  }

  try {
    const edition = await getEditionForPage(date);
    const story = findStoryBySlug(edition.content.stories, slug);

    if (!story) {
      notFound();
    }

    const adjacent = await getAdjacentEditionDates(date);

    return (
      <main className="paper-shell">
        <Masthead date={edition.date} issueNumber={edition.issue_num} />
        <div className="rule-heavy" />

        <section className="paper-body">
          <EditionNav previousDate={adjacent.previousDate} nextDate={adjacent.nextDate} />

          <article className="story-detail">
            <div className="story-detail-header">
              <h1 className="story-detail-hed">{story.headline}</h1>
              <p className="story-detail-byline">
                {story.category} • {story.source}
              </p>
            </div>

            <div className="story-detail-body">
              <p>{story.summary}</p>
            </div>

            <nav className="story-nav">
              <div className="story-nav-left">
                {adjacent.previousDate && (
                  <Link href={`/gazette/${adjacent.previousDate}`}>← Previous Edition</Link>
                )}
              </div>
              <div className="story-nav-center">
                <Link href={`/gazette/${date}`}>View Full Edition</Link>
              </div>
              <div className="story-nav-right">
                {adjacent.nextDate && (
                  <Link href={`/gazette/${adjacent.nextDate}`}>Next Edition →</Link>
                )}
              </div>
            </nav>
          </article>

          <MarketStrip brief={edition.content.market_brief} />

          <EditionNav previousDate={adjacent.previousDate} nextDate={adjacent.nextDate} />
        </section>
      </main>
    );
  } catch (error) {
    if (error instanceof NoEditionFoundError) {
      const today = toEditionDate();
      const inPast = compareEditionDate(date, today) < 0;

      return (
        <main className="paper-shell">
          <Masthead date={today} issueNumber={computeIssueNumber(today)} />
          <div className="rule-heavy" />
          <div className="paper-body">
            <ErrorPress
              title={inPast ? "No Edition Found" : "Edition Unavailable"}
              body={inPast ? `No edition found for ${date}.` : `Edition ${date} is not available yet.`}
              detail={error.message}
              showRetry={false}
            />
          </div>
        </main>
      );
    }

    throw error;
  }
}
