"use client";

import { ErrorPress } from "@/components/ErrorPress";

export default function GazetteError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="paper-body">
      <ErrorPress
        title="Press Breakdown"
        body="The edition failed to render. Restart the press and try again."
        digest={error.digest}
        reset={reset}
        showRetry
      />
    </div>
  );
}