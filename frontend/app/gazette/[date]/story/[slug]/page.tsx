import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";

import { isValidEditionDate, toEditionDate, computeIssueNumber } from "@/lib/date";
import {
  GenerationFailedError,
  NoEditionFoundError,
  getAdjacentEditionDates,
  getEditionForPage
} from "@/lib/edition-service";
import { buildEditionView, findStoryInView, CATEGORY_LABELS } from "@/lib/edition-view";
import { Masthead } from "@/components/Masthead";
import { EditionNav } from "@/components/EditionNav";
import { MarketStrip } from "@/components/MarketStrip";
import { ShareButton } from "@/components/ShareButton";

// Next 15: params is now a Promise
type PageProps = {
  params: Promise<{
    date: string;
    slug: string;
  }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { date, slug } = await params;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  if (!isValidEditionDate(date)) {
    return { title: "Story Not Found" };
  }

  try {
    const edition = await getEditionForPage(date);
    const view = buildEditionView(edition.content, date);
    const story = findStoryInView(view, slug);
    if (!story) {
      return { title: "Story Not Found" };
    }
    // SEO-03: use headline as title, first paragraph as description
    const description = story.paragraphs[0]?.slice(0, 160) ?? story.summary.slice(0, 160);
    return {
      title: story.headline,
      description,
      alternates: {
        canonical: `/gazette/${date}/story/${slug}`
      },
      openGraph: {
        title: story.headline,
        description,
        url: `${baseUrl}/gazette/${date}/story/${slug}`
      }
    };
  } catch {
    return {
      title: `Story | The Silicon Gazette ${date}`,
      description: "Read the full story from The Silicon Gazette.",
      alternates: { canonical: `/gazette/${date}/story/${slug}` }
    };
  }
}

export default async function StoryPage({ params }: PageProps) {
  const { date, slug } = await params;

  if (!isValidEditionDate(date)) {
    notFound();
  }

  try {
    const edition = await getEditionForPage(date);
    const view = buildEditionView(edition.content, date);
    const story = findStoryInView(view, slug);

    if (!story) {
      notFound();
    }

    const adjacent = await getAdjacentEditionDates(date);

    // Find prev/next story within this edition for story navigation
    const allStories = view.stories;
    const storyIndex = allStories.findIndex((s) => s.slug === slug);
    const prevStory = storyIndex > 0 ? allStories[storyIndex - 1] : null;
    const nextStory = storyIndex < allStories.length - 1 ? allStories[storyIndex + 1] : null;

    return (
      <main className="paper-shell">
        <Masthead date={edition.date} issueNumber={edition.issue_num} />
        <div className="rule-heavy" />

        <section className="paper-body">
          <div className="paper-toolbar" style={{ padding: "8px 0", display: "flex", gap: "12px", borderBottom: "1px solid var(--border)" }}>
            <Link href={`/gazette/${date}#sec-${story.sectionId}`} className="cmd-trigger" style={{ textDecoration: 'none' }}>
              <span className="cmd-trigger__icon">←</span>
              <span className="cmd-trigger__label">Back to Section</span>
            </Link>
            <Link href={`/gazette/${date}`} className="cmd-trigger" style={{ textDecoration: 'none' }}>
              <span className="cmd-trigger__icon">📰</span>
              <span className="cmd-trigger__label">Full Edition</span>
            </Link>
          </div>

          <article className="story-detail">
            <div className="story-detail-header">
              <p className="s-cat">{CATEGORY_LABELS[story.category as keyof typeof CATEGORY_LABELS] || story.category}</p>
              <h1 className="story-detail-hed">{story.headline}</h1>
              <p className="story-detail-byline">
                {story.source}
                {story.readMinutes > 0 ? ` · ${story.readMinutes} min read` : ""}
                {story.sourceUrl && (
                  <>
                    {" · "}
                    <a href={story.sourceUrl} target="_blank" rel="noopener noreferrer" className="source-link">
                      Read Source
                    </a>
                  </>
                )}
              </p>
            </div>

            <div className="story-detail-body">
              {story.paragraphs.map((paragraph, idx) => (
                <p key={`para-${idx}`} className={idx === 0 ? "drop-cap" : undefined}>
                  {paragraph}
                </p>
              ))}
            </div>

            {/* Prev / next story within the edition */}
            {(prevStory || nextStory) && (
              <nav className="story-prev-next" aria-label="Adjacent stories">
                <div className="story-nav-left">
                  {prevStory && (
                    <Link href={prevStory.href} className="story-nav-link">
                      <span className="story-nav-label">← Previous</span>
                      <span className="story-nav-headline">{prevStory.headline}</span>
                    </Link>
                  )}
                </div>
                <div className="story-nav-right">
                  {nextStory && (
                    <Link href={nextStory.href} className="story-nav-link story-nav-link--right">
                      <span className="story-nav-label">Next →</span>
                      <span className="story-nav-headline">{nextStory.headline}</span>
                    </Link>
                  )}
                </div>
              </nav>
            )}

            <nav className="story-nav" aria-label="Edition navigation">
              <div className="story-nav-left">
                {adjacent.previousDate && (
                  <Link href={`/gazette/${adjacent.previousDate}`}>← Previous Edition</Link>
                )}
              </div>
              <div className="story-nav-center">
                <Link href={`/gazette/${date}`}>Return to Edition Index</Link>
              </div>
              <div className="story-nav-right">
                {adjacent.nextDate && (
                  <Link href={`/gazette/${adjacent.nextDate}`}>Next Edition →</Link>
                )}
              </div>
            </nav>

            <div style={{ marginTop: "16px" }}>
              <ShareButton />
            </div>
          </article>

          <MarketStrip brief={view.marketBrief} />
        </section>
      </main>
    );
  } catch (error) {
    if (error instanceof NoEditionFoundError) {
      notFound();
    }
    if (error instanceof GenerationFailedError) {
      const today = toEditionDate();
      return (
        <main className="paper-shell">
          <Masthead date={today} issueNumber={computeIssueNumber(today)} />
          <div className="rule-heavy" />
          <div className="paper-body">
            <div className="err-wrap" role="alert">
              <h2 className="err-hed">Press Breakdown</h2>
              <p className="err-body">Unable to load this story right now. Please try again shortly.</p>
              <Link className="refresh-btn" href={`/gazette/${date}`}>Back to Edition</Link>
            </div>
          </div>
        </main>
      );
    }

    throw error;
  }
}
