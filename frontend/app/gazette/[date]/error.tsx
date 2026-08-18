"use client";

import { ErrorPress } from "@/components/ErrorPress";

export default function GazetteError({ error }: { error: Error }) {
  return (
    <div className="paper-body">
      <ErrorPress
        title="Press Breakdown"
        body="The edition failed to render. Restart the press and try again."
        detail={error.message}
      />
    </div>
  );
}