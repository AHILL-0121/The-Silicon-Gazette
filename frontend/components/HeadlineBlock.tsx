import type { EditionView } from "@/lib/edition-view";

type Lead = EditionView["lead"];

interface HeadlineBlockProps {
  lead: Lead;
}

export function HeadlineBlock({ lead }: HeadlineBlockProps) {
  return (
    <section className="headline-block">
      <div style={{ textAlign: "center" }}>
        <div className="cat-label">{lead.category}</div>
      </div>

      <h1 className="main-hed">
        {lead.sourceUrl ? (
          <a
            href={lead.sourceUrl}
            className="headline-link"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Read source for: ${lead.title}`}
          >
            {lead.title}
          </a>
        ) : (
          lead.title
        )}
      </h1>
      <p className="main-deck">{lead.deck}</p>
      <p className="byline">
        By The Silicon Gazette AI Desk —{" "}
        {lead.sourceUrl ? (
          <a href={lead.sourceUrl} className="source-link" target="_blank" rel="noopener noreferrer">
            {lead.source}
          </a>
        ) : (
          lead.source
        )}
        {lead.readMinutes > 0 && (
          <span style={{ marginLeft: "8px", fontStyle: "normal" }}>· {lead.readMinutes} min read</span>
        )}
      </p>

      <div className="main-body">
        {lead.paragraphs.map((paragraph, idx) => (
          <p className={idx === 0 ? "drop-cap" : undefined} key={`lead-para-${idx}`}>
            {paragraph}
          </p>
        ))}
      </div>
    </section>
  );
}