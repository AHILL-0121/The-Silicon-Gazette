import Link from "next/link";

import { generateSlug } from "@/lib/slugs";
import type { Story } from "@/lib/types";

interface StoryCardProps {
  story: Story;
  date?: string;
}

export function StoryCard({ story, date = "" }: StoryCardProps) {
  const storyLink = date ? `/gazette/${date}/story/${generateSlug(story.headline)}` : "#";

  return (
    <article className="story">
      <p className="s-cat">{story.category}</p>
      <h3 className="s-hed">
        <Link href={storyLink} className="headline-link">
          {story.headline}
        </Link>
      </h3>
      <p className="s-body">{story.summary}</p>
      <p className="s-src">{story.source}</p>
    </article>
  );
}