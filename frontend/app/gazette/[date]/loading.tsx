import { LoadingPress } from "@/components/LoadingPress";
import { Masthead } from "@/components/Masthead";
import { computeIssueNumber, toEditionDate } from "@/lib/date";

export default function GazetteLoadingPage() {
  const today = toEditionDate();
  return (
    <main className="paper-shell">
      <Masthead date={today} issueNumber={computeIssueNumber(today)} />
      <div className="rule-heavy" />
      <div className="paper-body">
        <LoadingPress />
      </div>
    </main>
  );
}