import Link from "next/link";

import { formatDisplayDate } from "@/lib/date";

interface EditionPagerProps {
  previousDate: string | null;
  nextDate: string | null;
}

/** Previous / next printed edition. */
export function EditionPager({ previousDate, nextDate }: EditionPagerProps) {
  if (!previousDate && !nextDate) return null;
  const card = (date: string, direction: "previous" | "next") => (
    <Link
      href={`/gazette/${date}`}
      className={`group flex flex-col gap-2 rounded-2xl border border-rule p-5 transition-colors hover:border-ink sm:p-6 ${direction === "next" ? "sm:items-end sm:text-right" : ""
        }`}
      data-track="edition_nav"
      data-track-dir={direction === "previous" ? "prev" : "next"}
    >
      <span className="label">{direction === "previous" ? "← Previous edition" : "Next edition →"}</span>
      <span className="font-display text-2xl leading-tight group-hover:text-signal sm:text-3xl">{formatDisplayDate(date)}</span>
    </Link>
  );

  return (
    <nav aria-label="Other editions" className="grid gap-3 sm:grid-cols-2">
      {previousDate ? card(previousDate, "previous") : <span className="hidden sm:block" />}
      {nextDate ? card(nextDate, "next") : null}
    </nav>
  );
}
