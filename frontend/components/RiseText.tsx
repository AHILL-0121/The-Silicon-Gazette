import type { CSSProperties } from "react";

/**
 * Word-by-word line-mask reveal (after 21st.dev's "Horizontal Feature Reveal"
 * headline). Each word rises out of its own clipped box. Pure CSS, so it plays
 * on the server-rendered HTML; screen readers get the plain text via the parent.
 */
export function RiseText({ text, baseDelayMs = 0, startIndex = 0 }: { text: string; baseDelayMs?: number; startIndex?: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <>
      {words.map((word, index) => (
        <span key={`${word}-${index}`} aria-hidden="true">
          <span className="rise">
            <span style={{ "--i": startIndex + index, "--base": `${baseDelayMs}ms` } as CSSProperties}>{word}</span>
          </span>
          {index < words.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}
