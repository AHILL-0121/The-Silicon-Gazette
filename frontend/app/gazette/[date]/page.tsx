import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EditionNav } from "@/components/EditionNav";
import { HeadlineBlock } from "@/components/HeadlineBlock";
import { HeadlineTicker } from "@/components/HeadlineTicker";
import { MarketStrip } from "@/components/MarketStrip";
import { Masthead } from "@/components/Masthead";
import { PageTurner } from "@/components/PageTurner";
import { RepoCard } from "@/components/RepoCard";
import { ShareButton } from "@/components/ShareButton";
import { StickyMasthead } from "@/components/StickyMasthead";
import { StoryCard } from "@/components/StoryCard";
import { CommandPalette } from "@/components/CommandPalette";
import type { CommandEntry } from "@/components/CommandPalette";
import { compareEditionDate, computeIssueNumber, formatDisplayDate, isValidEditionDate, toEditionDate } from "@/lib/date";
import {
  GenerationFailedError,
  NoEditionFoundError,
  getAdjacentEditionDates,
  getEditionForPage,
  getLatestEditionDate
} from "@/lib/edition-service";
import { buildEditionView, CATEGORY_LABELS } from "@/lib/edition-view";

// Allow up to 2 minutes for on-demand generation on today's page (PERF-02)
export const maxDuration = 120;

// Next 15: params is now a Promise
type PageProps = {
  params: Promise<{
    date: string;
  }>;
};

// Past editions never change; revalidate = false means they are cached indefinitely.
// Today's edition is always rendered fresh (it is generated on demand).
export const dynamic = "auto";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { date } = await params;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  if (!isValidEditionDate(date)) {
    return {
      title: "Edition Not Found"
    };
  }

  // Try fetching edition data for richer OG
  try {
    const edition = await getEditionForPage(date);
    const view = buildEditionView(edition.content, date);
    return {
      title: `${view.lead.title} | ${date}`,
      description: view.lead.deck,
      alternates: {
        canonical: `/gazette/${date}`
      },
      openGraph: {
        title: `The Silicon Gazette | ${date}`,
        description: view.lead.deck,
        url: `${baseUrl}/gazette/${date}`,
        images: [
          {
            url: `/og/edition-card.svg`,
            width: 1200,
            height: 630,
            alt: `The Silicon Gazette edition ${date}`
          }
        ]
      }
    };
  } catch {
    return {
      title: `Edition ${date}`,
      description: `The Silicon Gazette daily issue for ${date}.`,
      alternates: { canonical: `/gazette/${date}` }
    };
  }
}

export default async function GazetteDatePage({ params }: PageProps) {
  const { date } = await params;

  if (!isValidEditionDate(date)) {
    notFound();
  }

  try {
    const edition = await getEditionForPage(date);
    const adjacent = await getAdjacentEditionDates(date);
    const view = buildEditionView(edition.content, date);

    const { lead, stories, repos, sections, marketBrief } = view;

    // Front-page columns: first 3 stories left, next 3 center
    const frontPageLeft = stories.slice(0, 3);
    const frontPageCenter = stories.slice(3, 6);

    // Command palette entries for ⌘K search
    const cmdEntries: CommandEntry[] = [
      ...stories.map((s) => ({
        id: `story-${s.slug}`,
        label: s.headline,
        sublabel: `${CATEGORY_LABELS[s.category]} · ${s.source}`,
        href: s.href,
        category: "story" as const,
      })),
      ...sections.map((sec) => ({
        id: `section-${sec.id}`,
        label: sec.label,
        sublabel: sec.kicker,
        href: `#sec-${sec.id}`,
        category: "section" as const,
      })),
      ...repos.map((r) => ({
        id: `repo-${r.name}`,
        label: r.name,
        sublabel: r.description,
        href: r.href,
        category: "repo" as const,
      })),
      { id: "nav-archive", label: "Archive", sublabel: "All published editions", href: "/archive", category: "nav" as const },
    ];

    const pages = [
      {
        id: "front-page",
        label: "Front Page",
        subtitle: "Lead stories and repo watch",
        content: (
          <>
            <div className="page-label">Page 1 — Front Page</div>
            <div className="issue-date">{formatDisplayDate(date)}</div>
            <HeadlineBlock lead={lead} />
            <div className="rule-light" />
            <section className="three-col" aria-label="Front page columns">
              <section className="col">
                <h2 className="col-head">Tech Dispatch</h2>
                <div className="col-content">
                  {frontPageLeft.map((story) => (
                    <StoryCard key={story.slug} story={story} />
                  ))}
                </div>
              </section>

              <section className="col">
                <h2 className="col-head">Machine Intelligence</h2>
                <div className="col-content">
                  {frontPageCenter.map((story) => (
                    <StoryCard key={story.slug} story={story} />
                  ))}
                </div>
              </section>

              <section className="col">
                <h2 className="col-head">The Repo Beat</h2>
                <div className="col-content">
                  {repos.slice(0, 5).map((repo) => (
                    <RepoCard key={repo.name} repo={repo} />
                  ))}
                </div>
              </section>
            </section>
          </>
        )
      },
      // Render one page per section, skipping empty sections
      ...sections.map((section, sectionIdx) => ({
        id: `sec-${section.id}`,
        label: section.label,
        subtitle: section.kicker,
        content: (
          <>
            <div className="page-label">Page {sectionIdx + 2} — {section.label}</div>
            <div className="page-kicker">{section.kicker}</div>
            <section className="two-col" aria-label={`${section.label} columns`}>
              <section className="col">
                <h2 className="col-head">{section.label}</h2>
                <div className="col-content">
                  {section.stories.map((story) => (
                    <StoryCard key={story.slug} story={story} />
                  ))}
                </div>
              </section>

              <section className="col">
                <h2 className="col-head">From the Wire</h2>
                <div className="note-box">{`"`}{lead.deck}{`"`}</div>
                <ul className="index-list" style={{ marginTop: "12px" }}>
                  {stories.slice(0, 6).map((s) => (
                    <li className="index-item" key={s.slug}>
                      <span className="index-kicker">{CATEGORY_LABELS[s.category]}</span>
                      <Link href={s.href} className="index-title">{s.headline}</Link>
                      <span className="index-meta">{s.source}{s.readMinutes > 0 ? ` · ${s.readMinutes} min read` : ""}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </section>
          </>
        )
      })),
      {
        id: "open-source",
        label: "Open Source",
        subtitle: "Core tooling and systems watch",
        content: (
          <>
            <div className="page-label">Page {sections.length + 2} — Open Source & Systems</div>
            <div className="page-kicker">Community releases, hardware moves, and platform work.</div>
            <section className="three-col" aria-label="Open source columns">
              <section className="col">
                <h2 className="col-head">Open Source Watch</h2>
                <div className="col-content">
                  {stories.filter((s) => s.category === "OPEN SOURCE").map((story) => (
                    <StoryCard key={story.slug} story={story} />
                  ))}
                  {stories.filter((s) => s.category === "OPEN SOURCE").length === 0 && (
                    <p className="s-body" style={{ color: "var(--muted)", fontStyle: "italic" }}>No open-source stories this edition.</p>
                  )}
                </div>
              </section>

              <section className="col">
                <h2 className="col-head">Hardware & Systems</h2>
                <div className="col-content">
                  {stories.filter((s) => s.category === "HARDWARE").map((story) => (
                    <StoryCard key={story.slug} story={story} />
                  ))}
                  {stories.filter((s) => s.category === "HARDWARE").length === 0 && (
                    <p className="s-body" style={{ color: "var(--muted)", fontStyle: "italic" }}>No hardware stories this edition.</p>
                  )}
                </div>
              </section>

              <section className="col">
                <h2 className="col-head">Repo Ledger</h2>
                <div className="col-content">
                  {repos.map((repo) => (
                    <RepoCard key={`${repo.name}-ledger`} repo={repo} />
                  ))}
                </div>
              </section>
            </section>
          </>
        )
      },
      {
        id: "wire-index",
        label: "Wire Index",
        subtitle: "Full rundown and sources",
        content: (
          <>
            <div className="page-label">Page {sections.length + 3} — Wire Index</div>
            <div className="page-kicker">All stories in the edition, ordered for fast reading.</div>
            <section className="one-col" aria-label="Wire index">
              <section className="col">
                <h2 className="col-head">Edition Index</h2>
                <ul className="index-list" role="list">
                  {stories.map((story, idx) => (
                    <li className="index-item" key={story.slug} role="listitem">
                      <span className="index-kicker">Story {idx + 1}</span>
                      <Link href={story.href} className="index-title">
                        {story.headline}
                      </Link>
                      <span className="index-meta">
                        {CATEGORY_LABELS[story.category]} | {story.source}
                        {story.readMinutes > 0 ? ` · ${story.readMinutes} min` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </section>
          </>
        )
      },
      {
        id: "editors-desk",
        label: "Editors Desk",
        subtitle: "Letters, notes, and the day ahead",
        content: (
          <>
            <div className="page-label">Page {sections.length + 4} — Editors Desk</div>
            <div className="page-kicker">Context from the desk and the day ahead.</div>
            <section className="two-col" aria-label="Editors desk columns">
              <section className="col">
                <h2 className="col-head">Editors Letter</h2>
                <div className="editorial-body">
                  {lead.paragraphs.map((paragraph, idx) => (
                    <p key={`editorial-${idx}`} className={idx === 0 ? "drop-cap" : undefined}>{paragraph}</p>
                  ))}
                </div>
              </section>

              <section className="col">
                <h2 className="col-head">Today at a Glance</h2>
                <div className="note-box">
                  Issue No. {edition.issue_num} | Vol. I
                </div>
                <div className="note-box">{`"`}{marketBrief}{`"`}</div>
                <ul className="index-list" style={{ marginTop: "12px" }} role="list">
                  {stories.slice(0, 6).map((story) => (
                    <li className="index-item" key={`glance-${story.slug}`} role="listitem">
                      <Link href={story.href} className="index-title">
                        {story.headline}
                      </Link>
                      <span className="index-meta">{story.source}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </section>
          </>
        )
      },
      {
        id: "back-page",
        label: "Back Page",
        subtitle: "Market brief and highlights",
        content: (
          <>
            <div className="page-label">Page {sections.length + 5} — Back Page</div>
            <div className="page-kicker">Final briefs, share, and closing notes.</div>
            <section className="two-col" aria-label="Back page columns">
              <section className="col">
                <h2 className="col-head">Final Wire</h2>
                <div className="col-content">
                  {stories.map((story) => (
                    <article className="story" key={`final-${story.slug}`}>
                      <p className="s-cat">
                        <Link href={story.href} className="headline-link">{story.headline}</Link>
                      </p>
                      <p className="s-src">{story.source}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="col">
                <h2 className="col-head">Market Brief</h2>
                <div className="market-panel">{`"`}{marketBrief}{`"`}</div>
                <div className="rule-light" />
                <h2 className="col-head">Share The Edition</h2>
                <ShareButton />
              </section>
            </section>
            <MarketStrip brief={marketBrief} />
          </>
        )
      }
    ];

    return (
      <main className="paper-shell">
        <StickyMasthead date={edition.date} issueNumber={edition.issue_num} />
        <Masthead date={edition.date} issueNumber={edition.issue_num} />
        <HeadlineTicker headlines={stories.map((s) => s.headline)} />
        <div className="rule-heavy" />

        <section className="paper-body">
          <div className="paper-toolbar">
            <EditionNav previousDate={adjacent.previousDate} nextDate={adjacent.nextDate} />
            <CommandPalette entries={cmdEntries} />
          </div>
          <PageTurner pages={pages} />
          <EditionNav previousDate={adjacent.previousDate} nextDate={adjacent.nextDate} />
        </section>
      </main>
    );
  } catch (error) {
    if (error instanceof NoEditionFoundError) {
      const today = toEditionDate();
      const inPast = compareEditionDate(date, today) < 0;
      const latestDate = await getLatestEditionDate();

      if (inPast) {
        // Real 404 for missing past editions
        notFound();
      }

      return (
        <main className="paper-shell">
          <Masthead date={today} issueNumber={computeIssueNumber(today)} />
          <div className="rule-heavy" />
          <div className="paper-body">
            <div className="err-wrap" role="alert">
              <h2 className="err-hed">Edition Unavailable</h2>
              <p className="err-body">
                Edition {date} is not available yet — the presses are still running.
              </p>
              {latestDate && (
                <Link className="refresh-btn" href={`/gazette/${latestDate}`}>
                  Read Latest Edition
                </Link>
              )}
            </div>
          </div>
        </main>
      );
    }

    if (error instanceof GenerationFailedError) {
      const today = toEditionDate();
      const latestDate = await getLatestEditionDate();
      return (
        <main className="paper-shell">
          <Masthead date={today} issueNumber={computeIssueNumber(today)} />
          <div className="rule-heavy" />
          <div className="paper-body">
            <div className="err-wrap" role="alert">
              <h2 className="err-hed">Press Breakdown</h2>
              <p className="err-body">The presses hit a snag while generating this edition. Please try again shortly.</p>
              {latestDate && (
                <Link className="refresh-btn" href={`/gazette/${latestDate}`}>
                  Read Latest Edition
                </Link>
              )}
            </div>
          </div>
        </main>
      );
    }

    throw error;
  }
}