"use client";

import { track } from "@/lib/analytics/client";
import { toast } from "./Toaster";

interface ShareButtonProps {
  title: string;
  text?: string;
  /** Defaults to the current page URL without its hash. */
  url?: string;
  className?: string;
  label?: string;
}

/**
 * Opens the native share sheet where there is one (mostly mobile), otherwise
 * copies the link. Either way the reader gets visible feedback, including
 * when both fail.
 */
export function ShareButton({ title, text, url, className = "btn", label = "Share" }: ShareButtonProps) {
  async function share() {
    const shareUrl = url ? new URL(url, window.location.origin).toString() : window.location.href.split("#")[0];

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url: shareUrl });
        track("share", { method: "native" });
        return;
      } catch (error) {
        // The reader closed the sheet: nothing to report.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      track("share", { method: "clipboard" });
      toast("Link copied to clipboard");
    } catch {
      toast("Couldn't copy automatically. Copy the link from the address bar.");
    }
  }

  return (
    <button type="button" onClick={share} className={className}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 10V2m0 0L5 5m3-3 3 3M3 8.5V13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </button>
  );
}
