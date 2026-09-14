import Link from "next/link";

import { Masthead } from "@/components/Masthead";
import { ArchiveClient } from "@/components/ArchiveClient";
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
          <ArchiveClient editions={editions} />
        )}
      </section>
    </main>
  );
}