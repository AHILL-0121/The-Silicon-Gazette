import Link from "next/link";

export default function NotFound() {
  // SEO-05: link to "/" which redirects dynamically to today's edition,
  // rather than hard-coding the build date in the generated HTML.
  return (
    <main className="paper-shell">
      <div className="paper-body centered-block">
        <h1 className="err-hed">Edition Not Found</h1>
        <p className="err-body">
          That edition URL does not exist. Return to today&apos;s paper and spin up the latest issue.
        </p>
        <Link className="refresh-btn" href="/">
          Read Today&apos;s Edition
        </Link>
      </div>
    </main>
  );
}