/**
 * Splits text into per-word masks on the server so GSAP can animate words
 * (`[data-anim="words"]`, `[data-anim="scrub-words"]`) without rewriting the
 * DOM after hydration. Visible and readable as plain text when JS is off; the
 * parent element should carry the text as its accessible name.
 */
export function SplitWords({ text }: { text: string }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <>
      {words.map((word, index) => (
        <span key={`${word}-${index}`} aria-hidden="true">
          <span className="sw">
            <span className="sw-i">{word}</span>
          </span>
          {index < words.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}
