import Link from "next/link";

import { CATEGORY_LABELS } from "@/lib/edition-view";
import type { EditionSummary } from "@/lib/types";

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

function toDate(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

/** One page of printed editions, grouped by month. Server-rendered. */
export function ArchiveLedger({ editions }: { editions: EditionSummary[] }) {
  const months = new Map<string, EditionSummary[]>();
  for (const edition of editions) {
    const month = MONTH.format(toDate(edition.date));
    months.set(month, [...(months.get(month) ?? []), edition]);
  }

  return (
    <div>
      {[...months.entries()].map(([month, items]) => {
        const headingId = `month-${month.replace(/\s+/g, "-")}`;
        return (
          <section key={month} aria-labelledby={headingId} className="mt-12">
            <h2 id={headingId} className="flex items-baseline gap-4 border-b border-ink pb-3" data-reveal>
              <span className="font-display text-4xl">{month}</span>
              <span className="label">
                {items.length} {items.length === 1 ? "edition" : "editions"}
              </span>
            </h2>
            <ol className="divide-y divide-rule">
              {items.map((edition) => {
                const date = toDate(edition.date);
                return (
                  <li key={edition.date} data-reveal>
                    <Link
                      href={`/gazette/${edition.date}`}
                      className="group grid grid-cols-[5.5rem_1fr] gap-x-5 gap-y-1 py-6 sm:grid-cols-[8rem_1fr_auto] sm:items-center"
                    >
                      <span className="row-span-2 flex flex-col items-start sm:row-span-1">
                        <span className="font-display text-5xl leading-none transition-colors group-hover:text-signal">
                          {date.getUTCDate()}
                        </span>
                        <span className="label mt-1.5 whitespace-nowrap">
                          {WEEKDAY.format(date)} · No. {edition.issue_num}
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="chip mb-2">{CATEGORY_LABELS[edition.category] ?? edition.category}</span>
                        <span className="block font-display text-2xl leading-tight text-balance group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4 sm:text-3xl">
                          {edition.title}
                        </span>
                        <span className="mt-1 line-clamp-2 block font-serif text-ink-soft">{edition.deck}</span>
                      </span>
                      <span className="label col-start-2 mt-2 flex items-center gap-3 sm:col-start-3 sm:mt-0">
                        Read
                        <span aria-hidden="true" className="text-lg text-signal transition-transform group-hover:translate-x-1">
                          →
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
