import Link from "next/link";

import { editionCommands } from "@/lib/commands";
import { formatDisplayDate } from "@/lib/date";
import { CATEGORY_LABELS, urlHost, type EditionView, type SectionView } from "@/lib/edition-view";
import type { EditionRecord } from "@/lib/types";

import { editionGraph } from "@/lib/structured-data";

import { EditionPager } from "./EditionPager";
import { JsonLd } from "./JsonLd";
import { ScrollReveal, SpotlightArea } from "./Interactions";
import { Masthead } from "./Masthead";
import { MotionDirector } from "./MotionDirector";
import { RepoCard } from "./RepoCard";
import { RiseText } from "./RiseText";
import { SectionNav } from "./SectionNav";
import { ShareButton } from "./ShareButton";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { SplitWords } from "./SplitWords";
import { StoryCard } from "./StoryCard";
import { WireTicker } from "./WireTicker";

interface EditionPageProps {
  edition: EditionRecord;
  view: EditionView;
  previousDate: string | null;
  nextDate: string | null;
}

const PRINTED_AT = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

function SectionHeader({ number, id, title, kicker, count }: { number: string; id: string; title: string; kicker: string; count?: string }) {
  return (
    <header className="mb-8">
      <div data-anim="rule" className="h-px bg-ink" aria-hidden="true" />
      <div className="grid gap-4 pt-5 md:grid-cols-[1fr_minmax(0,24rem)] md:items-end">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-sm text-signal" aria-hidden="true">
            §{number}
          </span>
          <h2 id={id} aria-label={title} data-anim="words" className="font-display text-[clamp(2.5rem,5.5vw,4.5rem)] leading-[0.9]">
            <SplitWords text={title} />
          </h2>
        </div>
        <p className="font-serif text-lg italic text-ink-soft md:text-right">
          {kicker}
          {count && <span className="label ml-3 whitespace-nowrap not-italic">{count}</span>}
        </p>
      </div>
    </header>
  );
}

function SectionGrid({ section }: { section: SectionView }) {
  const count = section.stories.length;
  const columns = count === 1 ? "" : count === 2 ? "md:grid-cols-2" : "md:grid-cols-2 lg:grid-cols-3";
  return (
    <div className={`grid gap-4 ${columns}`}>
      {section.stories.map((story, index) => (
        <StoryCard key={story.slug} story={story} variant={index > 0 || count === 2 ? "standard" : count === 1 ? "solo" : "feature"} index={index} />
      ))}
    </div>
  );
}

export function EditionPage({ edition, view, previousDate, nextDate }: EditionPageProps) {
  const { lead, stories, sections, repos } = view;
  const displayDate = formatDisplayDate(edition.date);
  const briefing = stories.slice(0, 5);

  const navSections = [
    { id: "front", label: "Front page" },
    ...sections.map((section) => ({ id: section.id, label: section.label, count: section.stories.length })),
    ...(repos.length ? [{ id: "repos", label: "Repo Beat", count: repos.length }] : []),
    { id: "brief", label: "Market brief" }
  ];

  const commands = editionCommands(view, { sectionHref: (id) => `#${id}`, previousDate, nextDate });

  return (
    <>
      <SiteHeader entries={commands} mastheadId="masthead" dateline={displayDate} />
      <main id="main" tabIndex={-1} className="focus:outline-none">
        <JsonLd data={editionGraph(edition, view)} />
        <Masthead
          issueNumber={edition.issue_num}
          displayDate={displayDate}
          storyCount={stories.length + 1}
          readMinutes={view.totalReadMinutes}
        />
        <WireTicker
          items={stories.map((story) => ({
            href: story.href,
            label: story.headline,
            kicker: CATEGORY_LABELS[story.category]
          }))}
        />
        <SectionNav sections={navSections} />

        <SpotlightArea>
          {/* Front page: the lead story in full, plus the briefing index. */}
          <section id="front" tabIndex={-1} aria-labelledby="lead-title" data-anim="bg-drift" className="dotted-bg focus:outline-none">
            <div className="page-x grid gap-10 py-12 lg:grid-cols-12 lg:gap-12 lg:py-16">
              <article className="lg:col-span-8">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip chip-signal">
                    <span className="h-1.5 w-1.5 rounded-full bg-signal" aria-hidden="true" />
                    Lead story
                  </span>
                  <span className="chip">{CATEGORY_LABELS[lead.category]}</span>
                  <span className="label ml-1">{lead.readMinutes} min read</span>
                </div>
                <h2
                  id="lead-title"
                  aria-label={lead.title}
                  className="mt-6 font-display text-[clamp(2.6rem,6.2vw,5.75rem)] leading-[0.95] tracking-[-0.015em]"
                >
                  <RiseText text={lead.title} baseDelayMs={350} />
                </h2>
                <p className="mt-6 max-w-3xl font-serif text-[clamp(1.25rem,2vw,1.6rem)] italic leading-snug text-ink-soft text-pretty">
                  {lead.deck}
                </p>
                <div className="mt-8 gap-10 border-t border-rule pt-8 font-serif text-[1.125rem] leading-[1.7] text-ink md:columns-2">
                  {lead.paragraphs.map((paragraph, index) => (
                    <p key={index} className={`mb-5 text-pretty ${index === 0 ? "drop-cap" : ""}`}>
                      {paragraph}
                    </p>
                  ))}
                </div>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  {lead.sourceUrl ? (
                    <a
                      href={lead.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn"
                      data-track="source_click"
                      data-track-host={urlHost(lead.sourceUrl)}
                    >
                      Read at {lead.sourceLabel}
                      <span aria-hidden="true">↗</span>
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  ) : (
                    <span className="label">Source: {lead.sourceLabel}</span>
                  )}
                  <ShareButton title={`The Silicon Gazette · ${displayDate}`} text={lead.title} label="Share edition" />
                </div>
              </article>

              <aside aria-labelledby="briefing-title" className="lg:col-span-4 lg:border-l lg:border-rule lg:pl-10">
                <h2 id="briefing-title" className="label border-b border-ink pb-3 text-ink">
                  Inside today
                </h2>
                <ol className="divide-y divide-rule">
                  {briefing.map((story, index) => (
                    <li key={story.slug} data-reveal className="group relative flex gap-4 py-5">
                      <span className="font-display text-4xl leading-none text-rule transition-colors group-hover:text-signal" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span>
                        <span className="label">{CATEGORY_LABELS[story.category]}</span>
                        <Link href={story.href} className="stretched-link mt-1.5 block font-display text-[1.45rem] leading-tight group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
                          {story.headline}
                        </Link>
                        <span className="label mt-2 block">{story.readMinutes} min read</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <a href="#brief" className="mt-4 block rounded-2xl bg-ink p-5 text-paper transition-transform hover:-translate-y-0.5">
                  <span className="label text-paper/60">Market brief</span>
                  <span className="mt-2 block font-serif text-lg leading-snug">{view.marketBrief}</span>
                </a>
              </aside>
            </div>
          </section>

          {sections.map((section, index) => (
            <section key={section.id} id={section.id} tabIndex={-1} aria-labelledby={`${section.id}-title`} className="page-x py-14 focus:outline-none">
              <SectionHeader
                number={String(index + 1).padStart(2, "0")}
                id={`${section.id}-title`}
                title={section.label}
                kicker={section.kicker}
                count={`${section.stories.length} ${section.stories.length === 1 ? "story" : "stories"}`}
              />
              <SectionGrid section={section} />
            </section>
          ))}

          {repos.length > 0 && (
            <section id="repos" tabIndex={-1} aria-labelledby="repos-title" className="page-x py-14 focus:outline-none">
              <SectionHeader
                number={String(sections.length + 1).padStart(2, "0")}
                id="repos-title"
                title="The Repo Beat"
                kicker="What developers starred and forked today"
              />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {repos.map((repo, index) => (
                  <RepoCard key={repo.name} repo={repo} rank={index + 1} />
                ))}
              </div>
            </section>
          )}
        </SpotlightArea>

        <section id="brief" tabIndex={-1} aria-labelledby="brief-title" className="page-x py-14 focus:outline-none">
          <div data-parallax-root className="relative overflow-hidden rounded-[2rem] bg-ink px-6 py-12 text-paper sm:px-12 sm:py-16">
            <div
              data-anim="parallax"
              data-speed="1.6"
              data-start="top bottom"
              className="pointer-events-none absolute -right-24 -top-40 h-80 w-80 rounded-full bg-signal/30 blur-3xl"
              aria-hidden="true"
            />
            <h2 id="brief-title" className="label text-paper/60">
              Market brief
            </h2>
            <p
              aria-label={`“${view.marketBrief}”`}
              data-anim="scrub-words"
              className="relative mt-5 max-w-5xl font-display text-[clamp(2rem,4.4vw,3.75rem)] leading-[1.02] text-balance"
            >
              <SplitWords text={`“${view.marketBrief}”`} />
            </p>
            <dl className="relative mt-10 grid grid-cols-2 gap-6 border-t border-paper/15 pt-6 sm:grid-cols-4">
              {(
                [
                  ["Issue", "No. ", edition.issue_num, ""],
                  ["Stories", "", stories.length + 1, ""],
                  ["Reading time", "", view.totalReadMinutes, " min"],
                  ["Printed", `${PRINTED_AT.format(new Date(edition.generated_at))} UTC`, null, ""]
                ] as const
              ).map(([term, prefix, count, suffix]) => (
                <div key={term}>
                  <dt className="label text-paper/60">{term}</dt>
                  <dd className="mt-2 font-display text-3xl tabular-nums">
                    {prefix}
                    {count !== null && (
                      <span data-anim="count" data-value={count}>
                        {count}
                      </span>
                    )}
                    {suffix}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <div className="page-x space-y-6 pb-6">
          <EditionPager previousDate={previousDate} nextDate={nextDate} />
          <p className="label text-center">
            Written by {edition.model} from live search results · Every link points to the original source
          </p>
        </div>
        <ScrollReveal />
        <MotionDirector />
      </main>
      <SiteFooter />
    </>
  );
}
