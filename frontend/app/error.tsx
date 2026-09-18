"use client";

import Link from "next/link";

import { ErrorState } from "@/components/ErrorState";

/**
 * Error boundary for pages outside an edition (the archive, the home
 * redirect). The server has already logged and alerted on the error; readers
 * only see its reference.
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" tabIndex={-1} className="focus:outline-none">
      <ErrorState
        title="Something went wrong on our end."
        body={<p>This page couldn&apos;t be loaded just now. Try again in a moment, or head back to today&apos;s paper.</p>}
        actions={
          <>
            <button type="button" onClick={reset} className="btn btn-signal">
              Try again
            </button>
            <Link href="/latest" className="btn">
              Read the latest edition
            </Link>
          </>
        }
        footnote={error.digest ? `Reference ${error.digest}` : undefined}
      />
    </main>
  );
}
