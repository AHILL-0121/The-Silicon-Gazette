import Link from "next/link";

import { Masthead } from "@/components/Masthead";
import { computeIssueNumber, toEditionDate } from "@/lib/date";
import { listArchive } from "@/lib/edition-service";

export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const editions = await listArchive();
  const today = toEditionDate();

  return (
    <main className="paper-shell">
      <Masthead date={today} issueNumber={computeIssueNumber(today)} />
      <div className="rule-heavy" />

      <section className="paper-body archive-wrap">
        <header className="archive-header">
          <h1 className="main-hed">Archive Ledger</h1>
          <p className="main-deck">Every printed edition, sorted by date.</p>
        </header>

        {editions.length === 0 ? (
          <p className="err-body">No editions have been published yet.</p>
        ) : (
          <div className="archive-table" role="table" aria-label="Published editions">
            <div className="archive-row archive-head" role="row">
              <span role="columnheader">Issue</span>
              <span role="columnheader">Date</span>
              <span role="columnheader">Lead Headline</span>
              <span role="columnheader">Category</span>
            </div>
            {editions.map((edition) => (
              <Link
                className="archive-row"
                href={`/gazette/${edition.date}`}
                key={edition.date}
                role="row"
              >
                <span>#{edition.issue_num}</span>
                <span>{edition.date}</span>
                <span>{edition.content.headline.title}</span>
                <span>{edition.content.headline.category}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}