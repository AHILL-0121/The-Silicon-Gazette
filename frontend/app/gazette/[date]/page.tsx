import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EditionNav } from "@/components/EditionNav";
import { ErrorPress } from "@/components/ErrorPress";
import { HeadlineBlock } from "@/components/HeadlineBlock";
import { MarketStrip } from "@/components/MarketStrip";
import { Masthead } from "@/components/Masthead";
import { PageTurner } from "@/components/PageTurner";
import { RepoCard } from "@/components/RepoCard";
import { ShareButton } from "@/components/ShareButton";
import { StoryCard } from "@/components/StoryCard";
import { compareEditionDate, computeIssueNumber, formatDisplayDate, isValidEditionDate, toEditionDate } from "@/lib/date";
import {
  GenerationFailedError,
  NoEditionFoundError,
  getAdjacentEditionDates,
  getEditionForPage
} from "@/lib/edition-service";
import { generateSlug } from "@/lib/slugs";

type PageProps = {
  params: {
    date: string;
  };
};

export const revalidate = 3600;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { date } = params;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  if (!isValidEditionDate(date)) {
    return {
      title: "Edition Not Found"
    };
  }

  return {
    title: `Edition ${date}`,
    description: `The Silicon Gazette daily issue for ${date}.`,
    alternates: {
      canonical: `/gazette/${date}`
    },
    openGraph: {
      title: `The Silicon Gazette | ${date}`,
      description: `Read issue ${date} of The Silicon Gazette.`,
      url: `${baseUrl}/gazette/${date}`,
      images: [
        {
          url: "/og/edition-card.svg",
          width: 1200,
          height: 630,
          alt: `The Silicon Gazette edition ${date}`
        }
      ]
    }
  };
}

export default async function GazetteDatePage({ params }: PageProps) {
  const { date } = params;

  if (!isValidEditionDate(date)) {
    notFound();
  }

  try {
    const edition = await getEditionForPage(date);
    const adjacent = await getAdjacentEditionDates(date);
    const stories = edition.content.stories;
    const repos = edition.content.repos;

    const frontPageLeft = stories.slice(0, 3);
    const frontPageCenter = stories.slice(3, 6);
    const editorialParagraphs = edition.content.headline.body.split(/\n\n+/).filter(Boolean);

    const byCategory = (category: string) => stories.filter((story) => story.category === category);
    const pickStories = (source: typeof stories, count: number) => {
      if (source.length >= count) {
        return source.slice(0, count);
      }
      const filler = stories.filter((story) => !source.includes(story)).slice(0, count - source.length);
      return [...source, ...filler];
    };

    const aiStories = byCategory("AI");
    const techStories = byCategory("TECH");
    const startupStories = byCategory("STARTUP");
    const openSourceStories = byCategory("OPEN SOURCE");
    const hardwareStories = byCategory("HARDWARE");
    const securityStories = byCategory("SECURITY");

    const aiFocus = pickStories(aiStories, 3);
    const techFocus = pickStories(techStories, 3);
    const startupFocus = pickStories(startupStories, 3);
    const marketFocus = pickStories([...startupStories, ...techStories], 3);
    const openSourceFocus = pickStories(openSourceStories, 2);
    const hardwareFocus = pickStories(hardwareStories, 2);
    const securityFocus = pickStories(securityStories, 3);
    const policyIndex = pickStories([...securityStories, ...techStories], 6);

    const pages = [
      {
        id: "front-page",
        label: "Front Page",
        subtitle: "Lead stories and repo watch",
        content: (
          <>
            <div className="page-label">Page 1 - Front Page</div>
            <div className="issue-date">{formatDisplayDate(date)}</div>
            <HeadlineBlock headline={edition.content.headline} />
            <div className="rule-light" />
            <section className="three-col" aria-label="Front page columns">
              <section className="col">
                <h2 className="col-head">Tech Dispatch</h2>
                <div className="col-content">
                  {frontPageLeft.map((story, idx) => (
                    <StoryCard key={`${story.headline}-${idx}`} story={story} date={date} />
                  ))}
                </div>
              </section>

              <section className="col">
                <h2 className="col-head">Machine Intelligence</h2>
                <div className="col-content">
                  {frontPageCenter.map((story, idx) => (
                    <StoryCard key={`${story.headline}-${idx}`} story={story} date={date} />
                  ))}
                </div>
              </section>

              <section className="col">
                <h2 className="col-head">The Repo Beat</h2>
                <div className="col-content">
                  {repos.slice(0, 5).map((repo, idx) => (
                    <RepoCard key={`${repo.name}-${idx}`} repo={repo} />
                  ))}
                </div>
              </section>
            </section>
          </>
        )
      },
      {
        id: "tech-ai",
        label: "Tech & AI",
        subtitle: "Signals from labs and platforms",
        content: (
          <>
            <div className="page-label">Page 2 - Tech and AI</div>
            <div className="page-kicker">Research highlights, product moves, and platform shifts.</div>
            <section className="two-col" aria-label="Tech and AI columns">
              <section className="col">
                <h2 className="col-head">Artificial Intelligence</h2>
                <div className="col-content">
                  {aiFocus.map((story, idx) => (
                    <StoryCard key={`${story.headline}-${idx}`} story={story} date={date} />
                  ))}
                </div>
              </section>

              <section className="col">
                <h2 className="col-head">Industry & Platforms</h2>
                <div className="col-content">
                  {techFocus.map((story, idx) => (
                    <StoryCard key={`${story.headline}-${idx}`} story={story} date={date} />
                  ))}
                  <div className="note-box">
                    <strong>From the wire:</strong> {edition.content.headline.deck}
                  </div>
                </div>
              </section>
            </section>
          </>
        )
      },
      {
        id: "markets-funding",
        label: "Markets & Funding",
        subtitle: "Capital, deals, and momentum",
        content: (
          <>
            <div className="page-label">Page 3 - Markets and Funding</div>
            <div className="page-kicker">Venture activity, funding rounds, and market signals.</div>
            <section className="two-col" aria-label="Markets and funding columns">
              <section className="col">
                <h2 className="col-head">Startup and Funding</h2>
                <div className="col-content">
                  {startupFocus.map((story, idx) => (
                    <StoryCard key={`${story.headline}-${idx}`} story={story} date={date} />
                  ))}
                </div>
              </section>

              <section className="col">
                <h2 className="col-head">Markets and Trends</h2>
                <div className="col-content">
                  {marketFocus.map((story, idx) => (
                    <StoryCard key={`${story.headline}-${idx}`} story={story} date={date} />
                  ))}
                  <div className="market-panel">"{edition.content.market_brief}"</div>
                </div>
              </section>
            </section>
          </>
        )
      },
      {
        id: "open-source",
        label: "Open Source",
        subtitle: "Core tooling and systems watch",
        content: (
          <>
            <div className="page-label">Page 4 - Open Source and Systems</div>
            <div className="page-kicker">Community releases, hardware moves, and platform work.</div>
            <section className="three-col" aria-label="Open source columns">
              <section className="col">
                <h2 className="col-head">Open Source Watch</h2>
                <div className="col-content">
                  {openSourceFocus.map((story, idx) => (
                    <StoryCard key={`${story.headline}-${idx}`} story={story} date={date} />
                  ))}
                </div>
              </section>

              <section className="col">
                <h2 className="col-head">Hardware & Systems</h2>
                <div className="col-content">
                  {hardwareFocus.map((story, idx) => (
                    <StoryCard key={`${story.headline}-${idx}`} story={story} date={date} />
                  ))}
                </div>
              </section>

              <section className="col">
                <h2 className="col-head">Repo Ledger</h2>
                <div className="col-content">
                  {repos.slice(0, 5).map((repo, idx) => (
                    <RepoCard key={`${repo.name}-${idx}-ledger`} repo={repo} />
                  ))}
                </div>
              </section>
            </section>
          </>
        )
      },
      {
        id: "security-policy",
        label: "Security",
        subtitle: "Risk, privacy, and policy",
        content: (
          <>
            <div className="page-label">Page 5 - Security and Policy</div>
            <div className="page-kicker">Threat briefings, regulation, and governance.</div>
            <section className="two-col" aria-label="Security and policy columns">
              <section className="col">
                <h2 className="col-head">Security Desk</h2>
                <div className="col-content">
                  {securityFocus.map((story, idx) => (
                    <StoryCard key={`${story.headline}-${idx}`} story={story} date={date} />
                  ))}
                </div>
              </section>

              <section className="col">
                <h2 className="col-head">Policy Index</h2>
                <ul className="index-list">
                  {policyIndex.map((story, idx) => {
                    const storyLink = `/gazette/${date}/story/${generateSlug(story.headline)}`;
                    return (
                      <li className="index-item" key={`${story.headline}-policy-${idx}`}>
                        <Link href={storyLink} className="index-title">
                          {story.headline}
                        </Link>
                        <span className="index-meta">{story.source}</span>
                      </li>
                    );
                  })}
                </ul>
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
            <div className="page-label">Page 6 - Wire Index</div>
            <div className="page-kicker">All stories in the edition, ordered for fast reading.</div>
            <section className="one-col" aria-label="Wire index">
              <section className="col">
                <h2 className="col-head">Edition Index</h2>
                <ul className="index-list">
                  {stories.map((story, idx) => {
                    const storyLink = `/gazette/${date}/story/${generateSlug(story.headline)}`;
                    return (
                      <li className="index-item" key={`${story.headline}-index-${idx}`}>
                        <span className="index-kicker">Story {idx + 1}</span>
                        <Link href={storyLink} className="index-title">
                          {story.headline}
                        </Link>
                        <span className="index-meta">{story.category} | {story.source}</span>
                      </li>
                    );
                  })}
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
            <div className="page-label">Page 7 - Editors Desk</div>
            <div className="page-kicker">Context from the desk and the day ahead.</div>
            <section className="two-col" aria-label="Editors desk columns">
              <section className="col">
                <h2 className="col-head">Editors Letter</h2>
                <div className="editorial-body">
                  {editorialParagraphs.map((paragraph, idx) => (
                    <p key={`${paragraph.slice(0, 20)}-${idx}`}>{paragraph}</p>
                  ))}
                </div>
              </section>

              <section className="col">
                <h2 className="col-head">Today at a Glance</h2>
                <div className="note-box">
                  Issue No. {edition.issue_num} | Vol. I
                </div>
                <div className="note-box">"{edition.content.market_brief}"</div>
                <ul className="index-list">
                  {stories.slice(0, 6).map((story, idx) => {
                    const storyLink = `/gazette/${date}/story/${generateSlug(story.headline)}`;
                    return (
                      <li className="index-item" key={`${story.headline}-glance-${idx}`}>
                        <Link href={storyLink} className="index-title">
                          {story.headline}
                        </Link>
                        <span className="index-meta">{story.source}</span>
                      </li>
                    );
                  })}
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
            <div className="page-label">Page 8 - Back Page</div>
            <div className="page-kicker">Final briefs, share, and closing notes.</div>
            <section className="two-col" aria-label="Back page columns">
              <section className="col">
                <h2 className="col-head">Final Wire</h2>
                <div className="col-content">
                  {stories.slice(0, 6).map((story, idx) => {
                    const storyLink = `/gazette/${date}/story/${generateSlug(story.headline)}`;
                    return (
                      <article className="story" key={`${story.headline}-final-${idx}`}>
                        <p className="s-cat">Brief {idx + 1}</p>
                        <h3 className="s-hed">
                          <Link href={storyLink} className="headline-link">
                            {story.headline}
                          </Link>
                        </h3>
                        <p className="s-src">{story.source}</p>
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className="col">
                <h2 className="col-head">Market Brief</h2>
                <div className="market-panel">"{edition.content.market_brief}"</div>
                <div className="rule-light" />
                <h2 className="col-head">Share The Edition</h2>
                <ShareButton />
              </section>
            </section>
            <MarketStrip brief={edition.content.market_brief} />
          </>
        )
      }
    ];

    return (
      <main className="paper-shell">
        <Masthead date={edition.date} issueNumber={edition.issue_num} />
        <div className="rule-heavy" />

        <section className="paper-body">
          <EditionNav previousDate={adjacent.previousDate} nextDate={adjacent.nextDate} />
          <PageTurner pages={pages} />

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
              body={
                inPast
                  ? `No edition found for ${date}.`
                  : `Edition ${date} is not available yet.`
              }
              detail={error.message}
              showRetry={false}
            />
          </div>
        </main>
      );
    }

    if (error instanceof GenerationFailedError) {
      const today = toEditionDate();
      return (
        <main className="paper-shell">
          <Masthead date={today} issueNumber={computeIssueNumber(today)} />
          <div className="rule-heavy" />
          <div className="paper-body">
            <ErrorPress
              title="Press Breakdown"
              body="The presses hit a snag while generating this edition."
              detail={error.message}
              showRetry
            />
          </div>
        </main>
      );
    }

    throw error;
  }
}