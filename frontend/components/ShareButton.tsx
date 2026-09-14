"use client";

import { useState } from "react";

export function ShareButton() {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  async function handleShare() {
    const url = window.location.href;
    const title = document.title;

    // Use native share sheet on supported mobile browsers
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // User cancelled or not supported — fall through to clipboard
      }
    }

    // Clipboard fallback
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 2500);
    } catch {
      // Clipboard failed — show the URL so users can copy manually
      setStatus("error");
      window.setTimeout(() => setStatus("idle"), 4000);
    }
  }

  return (
    <div className="share-row">
      <button
        id="share-edition-btn"
        className="refresh-btn"
        onClick={handleShare}
        type="button"
        aria-live="polite"
      >
        Share This Edition
      </button>

      {status === "copied" && (
        <span className="share-toast share-toast--ok" role="status" aria-live="polite">
          ✓ Link copied to clipboard
        </span>
      )}
      {status === "error" && (
        <span className="share-toast share-toast--err" role="alert" aria-live="assertive">
          Could not copy — please copy the URL from the address bar.
        </span>
      )}
    </div>
  );
}