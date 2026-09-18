import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

import { ReaderControls } from "@/components/ReaderControls";
import { ScrollReveal } from "@/components/Interactions";
import { MotionDirector } from "@/components/MotionDirector";
import { RiseText } from "@/components/RiseText";
import { ShareButton } from "@/components/ShareButton";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { JsonLd } from "@/components/JsonLd";
import { editionCommands } from "@/lib/commands";
import { OPEN_GRAPH_DEFAULTS, twitterCard } from "@/lib/metadata";
import { storyGraph } from "@/lib/structured-data";
import { formatDisplayDate } from "@/lib/date";
import { CATEGORY_LABELS, excerpt, type StoryView } from "@/lib/edition-view";
import { readAdjacentEditionDates } from "@/lib/edition-service";
import { lookupStory } from "@/lib/story-lookup";

// Per-request render over cached edition data (see the edition page).
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ date: string; slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { date, slug } = await params;
  const loaded = await lookupStory(date, slug).catch(() => null);
  if (loaded?.kind !== "ok") return { title: "Story not found" };
  const { story } = loaded;

  const description = excerpt(story.paragraphs[0] ?? story.summary, 160);
  return {
    // The layout template appends the brand once.
    title: story.headline,
    description,
    alternates: { canonical: story.href },
    openGraph: {
      ...OPEN_GRAPH_DEFAULTS,
      type: "article",
      title: story.headline,
      description,
      url: story.href,
      publishedTime: loaded.edition.generated_at,
      section: CATEGORY_LABELS[story.category]
    },
    twitter: twitterCard(story.headline, description, `${story.href}/opengraph-image`)
  };
}

function StoryLinkCard({ story, direction }: { story: StoryView; direction: "Previous" | "Next" }) {
  return (
    <Link
      href={story.href}
      className={`group flex h-full flex-col gap-3 rounded-2xl border border-rule p-5 transition-colors hover:border-ink sm:p-6 ${
        direction === "Next" ? "sm:text-right" : ""
      }`}
    >
      <span className="label">{direction === "Previous" ? "← Previous story" : "Next story →"}</span>
      <span className="font-display text-2xl leading-tight text-balance group-hover:text-signal">{story.headline}</span>
      <span className="label mt-auto">
        {CATEGORY_LABELS[story.category]} · {story.readMinutes} min
      </span>
    </Link>
  );
}

export default async function StoryPage({ params }: PageProps) {
  const { date, slug } = await params;
  // The layout has already turned missing stories into 404s and old slugs into redirects.
  const loaded = await lookupStory(date, slug);
  if (loaded.kind === "not-found") notFound();
  if (loaded.kind === "redirect") permanentRedirect(loaded.to);

  const { edition, view, story } = loaded;
  const adjacent = await readAdjacentEditionDates(date);
  const index = view.stories.findIndex((item) => item.slug === story.slug);
  const previous = index > 0 ? view.stories[index - 1] : null;
  const next = index < view.stories.length - 1 ? view.stories[index + 1] : null;
  const section = view.sections.find((item) => item.id === story.sectionId);
  const related = (section?.stories ?? []).filter((item) => item.slug !== story.slug).slice(0, 3);
  const displayDate = formatDisplayDate(date);

  const commands = editionCommands(view, {
    sectionHref: (id) => `/gazette/${date}#${id}`,
    previousDate: adjacent.previousDate,
    nextDate: adjacent.nextDate
  });

  return (
    <>
      <SiteHeader entries={commands} dateline={displayDate} />
      <main id="main" tabIndex={-1} className="focus:outline-none">
        <JsonLd data={storyGraph(edition, story, section?.label ?? CATEGORY_LABELS[story.category])} />
        <article aria-labelledby="story-title" className="page-x pb-10 pt-8 sm:pt-12">
          <nav aria-label="Breadcrumb" className="mx-auto max-w-measure">
            <ol className="label flex flex-wrap items-center gap-2">
              <li>
                <Link href={`/gazette/${date}`} className="hover:text-ink">
                  {displayDate}
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <Link href={`/gazette/${date}#${story.sectionId}`} className="hover:text-ink">
                  {section?.label ?? CATEGORY_LABELS[story.category]}
                </Link>
              </li>
            </ol>
          </nav>

          <header className="mx-auto mt-8 max-w-5xl text-center">
            <span className="chip chip-signal">{CATEGORY_LABELS[story.category]}</span>
            <h1
              id="story-title"
              aria-label={story.headline}
              className="mt-6 font-display text-[clamp(2.5rem,6.5vw,5.25rem)] leading-[0.95] tracking-[-0.015em] text-balance"
            >
              <RiseText text={story.headline} baseDelayMs={120} />
            </h1>
            <p className="label mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
              <span className="text-ink-soft">{story.sourceLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{story.readMinutes} min read</span>
              <span aria-hidden="true">·</span>
              <span>Issue No. {edition.issue_num}</span>
            </p>
          </header>

          <div className="mx-auto mt-10 flex max-w-measure flex-wrap items-center justify-between gap-3 border-y border-rule py-3">
            <ReaderControls targetId="story-body" />
            <div className="flex flex-wrap gap-2">
              <ShareButton title={story.headline} text={excerpt(story.summary, 120)} url={story.href} className="btn px-3.5" />
              {story.sourceUrl && (
                <a href={story.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn px-3.5">
                  Source <span aria-hidden="true">↗</span>
                  <span className="sr-only">: {story.sourceLabel} (opens in a new tab)</span>
                </a>
              )}
            </div>
          </div>

          <div id="story-body" className="reader mx-auto mt-10 max-w-measure font-serif leading-[1.75] text-ink">
            {story.paragraphs.map((paragraph, paragraphIndex) => (
              <p key={paragraphIndex} data-reveal className={`mb-6 text-pretty ${paragraphIndex === 0 ? "drop-cap" : ""}`}>
                {paragraph}
              </p>
            ))}
            <p className="mt-10 border-t border-rule pt-5 font-sans text-sm text-muted">
              This story was written by a language model from reporting by{" "}
              {story.sourceUrl ? (
                <a href={story.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-4">
                  {story.sourceLabel}
                </a>
              ) : (
                story.sourceLabel
              )}
              . Check the original before quoting it.
            </p>
          </div>
        </article>

        {(previous || next) && (
          <nav aria-label="More stories in this edition" className="page-x">
            <div className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-2">
              {previous ? <StoryLinkCard story={previous} direction="Previous" /> : <span className="hidden sm:block" />}
              {next && <StoryLinkCard story={next} direction="Next" />}
            </div>
          </nav>
        )}

        {related.length > 0 && (
          <section aria-labelledby="related-title" className="page-x mt-16">
            <div className="mx-auto max-w-5xl">
              <div data-anim="rule" className="h-px bg-ink" aria-hidden="true" />
              <h2 id="related-title" className="pt-5 font-display text-4xl">
                More from {section?.label}
              </h2>
              <ul className="mt-6 grid gap-6 md:grid-cols-3">
                {related.map((item) => (
                  <li key={item.slug} data-reveal className="group relative">
                    <p className="label">{item.sourceLabel}</p>
                    <Link href={item.href} className="stretched-link mt-2 block font-display text-2xl leading-tight group-hover:text-signal">
                      {item.headline}
                    </Link>
                    <p className="mt-2 line-clamp-3 font-serif text-ink-soft">{item.excerpt}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <div className="page-x mt-16 text-center">
          <Link href={`/gazette/${date}`} className="btn">
            ← Back to the {displayDate} edition
          </Link>
        </div>
        <ScrollReveal />
        <MotionDirector />
      </main>
      <SiteFooter />
    </>
  );
}
