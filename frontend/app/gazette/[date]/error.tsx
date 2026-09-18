"use client";

import Link from "next/link";
import { useEffect } from "react";

import { ErrorState } from "@/components/ErrorState";

/**
 * Shown when an edition fails to generate or render. Readers never see the
 * raw error message; the digest lets a maintainer find the full error in the
 * server logs.
 */
export default function EditionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Server errors arrive here already redacted in production.
    console.error(error);
  }, [error]);

  return (
    <main id="main" tabIndex={-1} className="focus:outline-none">
      <ErrorState
        title="The presses jammed."
        body={
          <p>
            We couldn&apos;t print this edition just now. The newsroom has been notified. You can try again in a few
            minutes, or read the most recent edition that made it to print.
          </p>
        }
        actions={
          <>
            <button type="button" onClick={reset} className="btn btn-signal">
              Try again
            </button>
            <Link href="/latest" className="btn">
              Read the latest edition
            </Link>
            <Link href="/archive" className="btn">
              Archive
            </Link>
          </>
        }
        footnote={error.digest ? `Reference ${error.digest}` : undefined}
      />
    </main>
  );
}
