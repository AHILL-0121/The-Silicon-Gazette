import Link from "next/link";

import { formatDisplayDate, toEditionDate } from "@/lib/date";

interface MastheadProps {
  date: string;
  issueNumber: number;
}

export function Masthead({ date, issueNumber }: MastheadProps) {
  const todayHref = `/gazette/${toEditionDate()}`;

  return (
    <header className="masthead">
      <div className="est-line">Est. 2026 - {formatDisplayDate(date)}</div>
      <div className="masthead-brand">
        <Link className="title title-link masthead-logo-link" href={todayHref}>
          The Silicon Gazette
        </Link>
      </div>
      <div className="tagline">All the code that&apos;s fit to print</div>

      <nav className="meta-bar" aria-label="Edition meta navigation">
        <span>Issue No. {issueNumber}</span>
        <span>Vol. I</span>
        <span>Daily Edition</span>
        <Link href="/archive">Archive</Link>
      </nav>
    </header>
  );
}