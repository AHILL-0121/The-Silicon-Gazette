import Link from "next/link";

import { CATEGORY_LABELS, type StoryView } from "@/lib/edition-view";

interface StoryCardProps {
  story: StoryView;
  /** feature: large card spanning two columns; solo: large card alone in its row. */
  variant?: "feature" | "solo" | "standard";
  index?: number;
}

/**
 * One story. The whole card is clickable through a stretched headline link,
 * so there is a single, well-named link per card for assistive tech.
 */
export function StoryCard({ story, variant = "standard", index }: StoryCardProps) {
  const feature = variant !== "standard";
  return (
    // The reveal animation runs on this wrapper so it never fights the card's
    // CSS hover transition on transform.
    <div data-reveal className={variant === "feature" ? "md:col-span-2 lg:row-span-2" : undefined}>
      <article
        className={`spotlight group flex h-full flex-col rounded-2xl border border-rule bg-surface p-5 transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-1 hover:border-ink/40 hover:shadow-[0_18px_40px_-24px_rgb(var(--ink)/0.45)] focus-within:border-ink/40 sm:p-6 ${feature ? "md:p-8" : ""
          }`}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="chip">{CATEGORY_LABELS[story.category]}</span>
          {typeof index === "number" && (
            <span className="font-mono text-xs text-muted" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
          )}
        </div>

        <h3
          className={`mt-4 font-display leading-[1.02] text-balance ${feature ? "text-[clamp(2rem,3.6vw,3.25rem)]" : "text-[1.75rem]"
            }`}
        >
          <Link
            href={story.href}
            className="stretched-link bg-[length:0%_1px] bg-left-bottom bg-no-repeat transition-[background-size] duration-500 [background-image:linear-gradient(currentColor,currentColor)] group-hover:bg-[length:100%_1px] focus:outline-none"
            data-track="story_open"
            data-track-section={story.category}
            data-track-position={typeof index === "number" ? index : 0}
          >
            {story.headline}
          </Link>
        </h3>

        <p className={`mt-3 font-serif text-ink-soft text-pretty ${feature ? "text-lg leading-relaxed md:text-xl" : "leading-relaxed"}`}>
          {feature ? story.paragraphs[0] ?? story.excerpt : story.excerpt}
        </p>

        <p className="label mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-6">
          <span className="text-ink-soft">{story.sourceLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{story.readMinutes} min read</span>
          <span aria-hidden="true" className="ml-auto text-base leading-none text-signal transition-transform duration-300 group-hover:translate-x-1">
            →
          </span>
        </p>
      </article>
    </div>
  );
}
