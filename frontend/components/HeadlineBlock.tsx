import Link from "next/link";

import type { Headline } from "@/lib/types";

interface HeadlineBlockProps {
  headline: Headline;
}

export function HeadlineBlock({ headline }: HeadlineBlockProps) {
  const paragraphs = headline.body.split(/\n\n+/).filter(Boolean);
  const hasReference = Boolean(headline.url);

  return (
    <section className="headline-block">
      <div style={{ textAlign: "center" }}>
        <div className="cat-label">{headline.category}</div>
      </div>

      <h1 className="main-hed">
        {hasReference ? (
          <Link
            href={headline.url as string}
            className="headline-link"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Read source for: ${headline.title}`}
          >
            {headline.title}
          </Link>
        ) : (
          headline.title
        )}
      </h1>
      <p className="main-deck">{headline.deck}</p>
      <p className="byline">
        By The Silicon Gazette AI Desk -{" "}
        {hasReference ? (
          <Link href={headline.url as string} className="source-link" target="_blank" rel="noopener noreferrer">
            {headline.source}
          </Link>
        ) : (
          headline.source
        )}
      </p>

      <div className="main-body">
        {paragraphs.map((paragraph, idx) => (
          <p className={idx === 0 ? "drop-cap" : undefined} key={`${paragraph.slice(0, 20)}-${idx}`}>
            {paragraph}
          </p>
        ))}
      </div>
    </section>
  );
}