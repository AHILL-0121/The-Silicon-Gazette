import Link from "next/link";

import { generateSlug } from "@/lib/slugs";
import { RepoCard } from "@/components/RepoCard";
import { StoryCard } from "@/components/StoryCard";
import type { Repo, Story } from "@/lib/types";

interface ThreeColumnProps {
  stories: Story[];
  repos: Repo[];
  date?: string;
}

const MIN_STORY_COUNT = 12;

function withReferenceUrl(story: Story, index: number): Story {
  const fallbackQuery = encodeURIComponent(`${story.headline} ${story.source}`.trim() || `technology news ${index + 1}`);
  return {
    ...story,
    url: story.url ?? `https://www.google.com/search?q=${fallbackQuery}`
  };
}

function fallbackStory(index: number): Story {
  const number = index + 1;
  return {
    headline: `Press Wire ${number}`,
    summary:
      "Additional reporting is being compiled for this section as newsroom wires continue to update through the day.",
    category: "TECH",
    source: "Gazette Desk",
    url: `https://www.google.com/search?q=${encodeURIComponent(`technology news ${number}`)}`
  };
}

export function ThreeColumn({ stories, repos, date = "" }: ThreeColumnProps) {
  const normalizedStories = stories.map(withReferenceUrl);

  while (normalizedStories.length < MIN_STORY_COUNT) {
    normalizedStories.push(fallbackStory(normalizedStories.length));
  }

  const frontPageLeft = normalizedStories.slice(0, 3);
  const frontPageCenter = normalizedStories.slice(3, 6);
  const insidePageLeft = normalizedStories.slice(6, 8);
  const insidePageCenter = normalizedStories.slice(8, 10);
  const deepDiveStories = normalizedStories.slice(10, 12);

  return (
    <>
      <nav className="section-index" aria-label="Section index">
        <span className="section-index-title">Section Index</span>
        <a href="#front-page">Front Page</a>
        <a href="#inside-news">Inside News</a>
        <a href="#deep-dive">Deep Dive</a>
        <Link href="/archive">Archive</Link>
      </nav>

      <section id="front-page" className="paper-page section-anchor" aria-label="Front page">
        <div className="page-label">Page 1 - Front Page</div>

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
      </section>

      <div className="rule-light" />

      <section id="inside-news" className="paper-page section-anchor" aria-label="Inside page">
        <div className="page-label">Page 2 - Inside News</div>

        <section className="three-col" aria-label="Inside page columns">
          <section className="col">
            <h2 className="col-head">Security & Policy</h2>
            <div className="col-content">
              {insidePageLeft.map((story, idx) => (
                <StoryCard key={`${story.headline}-${idx}`} story={story} date={date} />
              ))}
            </div>
          </section>

          <section className="col">
            <h2 className="col-head">Startup & Funding</h2>
            <div className="col-content">
              {insidePageCenter.map((story, idx) => (
                <StoryCard key={`${story.headline}-${idx}`} story={story} date={date} />
              ))}
            </div>
          </section>

          <section className="col">
            <h2 className="col-head">Reference Ledger</h2>
            <div className="col-scrollable">
              {normalizedStories.filter((story) => Boolean(story.url)).map((story, idx) => {
                const storyLink = date ? `/gazette/${date}/story/${generateSlug(story.headline)}` : "#";
                return (
                  <article className="story" key={`${story.url}-${idx}`}>
                    <p className="s-cat">Wire {idx + 1}</p>
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
        </section>
      </section>

      <div className="rule-light" />

      <section id="deep-dive" className="paper-page section-anchor" aria-label="Deep dive page">
        <div className="page-label">Page 3 - Deep Dive</div>

        <section className="three-col" aria-label="Deep dive columns">
          <section className="col">
            <h2 className="col-head">Open Source Watch</h2>
            <div className="col-content">
              {deepDiveStories.slice(0, 1).map((story, idx) => (
                <StoryCard key={`${story.headline}-${idx}`} story={story} date={date} />
              ))}
            </div>
          </section>

          <section className="col">
            <h2 className="col-head">Hardware & Systems</h2>
            <div className="col-content">
              {deepDiveStories.slice(1, 2).map((story, idx) => (
                <StoryCard key={`${story.headline}-${idx}`} story={story} date={date} />
              ))}
            </div>
          </section>

          <section className="col">
            <h2 className="col-head">Editor's Notebook</h2>
            <div className="col-scrollable">
              {normalizedStories.slice(0, 4).map((story, idx) => {
                const storyLink = date ? `/gazette/${date}/story/${generateSlug(story.headline)}` : "#";
                return (
                  <article className="story" key={`${story.headline}-notebook-${idx}`}>
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
        </section>
      </section>
    </>
  );
}