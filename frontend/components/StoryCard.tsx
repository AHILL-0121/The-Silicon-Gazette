import type { StoryView } from "@/lib/edition-view";

interface StoryCardProps {
  story: StoryView;
}

// Show a short excerpt (first paragraph, capped at ~180 chars) instead of the full summary
function excerpt(paragraphs: string[]): string {
  const first = paragraphs[0] ?? "";
  if (first.length <= 180) return first;
  const cut = first.slice(0, 180).lastIndexOf(" ");
  return first.slice(0, cut > 80 ? cut : 180) + "\u2026";
}

export function StoryCard({ story }: StoryCardProps) {
  return (
    <article className="story">
      <p className="s-cat">{story.category}</p>
      <h3 className="s-hed">
        <a href={story.href} className="headline-link">
          {story.headline}
        </a>
      </h3>
      <p className="s-body">{excerpt(story.paragraphs)}</p>
      <p className="s-src">
        {story.source}
        {story.readMinutes > 0 && (
          <span className="s-readtime"> · {story.readMinutes} min read</span>
        )}
      </p>
    </article>
  );
}