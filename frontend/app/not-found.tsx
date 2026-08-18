import Link from "next/link";

import { toEditionDate } from "@/lib/date";

export default function NotFound() {
  const today = toEditionDate();
  return (
    <main className="paper-shell">
      <div className="paper-body centered-block">
        <h1 className="err-hed">Edition Not Found</h1>
        <p className="err-body">
          That edition URL does not exist. Return to today&apos;s paper and spin up the latest issue.
        </p>
        <Link className="refresh-btn" href={`/gazette/${today}`}>
          Read Today&apos;s Edition
        </Link>
      </div>
    </main>
  );
}