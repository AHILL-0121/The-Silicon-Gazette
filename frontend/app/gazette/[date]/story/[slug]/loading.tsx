/**
 * Shown the moment a story link is clicked, while the server renders the
 * story. In production Next prefetches this boundary, so navigation feels
 * instant even before the page arrives.
 */
export default function StoryLoading() {
  const bar = "animate-blink rounded-full bg-rule";
  return (
    <div role="status" aria-live="polite" className="min-h-screen">
      <span className="sr-only">Loading story…</span>
      <div className="h-14 border-b border-rule" aria-hidden="true" />
      <div aria-hidden="true" className="page-x pb-10 pt-8 sm:pt-12">
        <div className={`mx-auto h-3 max-w-[18rem] ${bar}`} />
        <div className="mx-auto mt-10 flex max-w-5xl flex-col items-center gap-4">
          <div className={`h-6 w-24 ${bar}`} />
          <div className={`h-12 w-full max-w-4xl sm:h-16 ${bar}`} />
          <div className={`h-12 w-4/5 max-w-3xl sm:h-16 ${bar}`} />
          <div className={`mt-2 h-3 w-64 ${bar}`} />
        </div>
        <div className="mx-auto mt-10 h-14 max-w-measure border-y border-rule" />
        <div className="mx-auto mt-10 max-w-measure space-y-3">
          {[100, 96, 99, 92, 60, 0, 98, 94, 97, 70].map((width, index) =>
            width === 0 ? (
              <div key={index} className="h-4" />
            ) : (
              <div key={index} className={`h-4 ${bar}`} style={{ width: `${width}%` }} />
            )
          )}
        </div>
      </div>
    </div>
  );
}
