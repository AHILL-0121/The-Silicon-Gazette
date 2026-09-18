"use client";

import "./globals.css";

/**
 * Last-resort boundary for errors in the root layout itself. It replaces the
 * whole document, so it can't rely on the layout's fonts, header or scripts,
 * and uses plain links (a full reload) rather than client navigation.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" data-theme="light">
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center" style={{ fontFamily: "Georgia, serif" }}>
          <p className="label">The Silicon Gazette</p>
          <h1 className="mt-4 max-w-2xl text-5xl leading-tight">Stop the presses: the site hit an unexpected error.</h1>
          <p className="mt-4 max-w-md text-lg text-ink-soft">Please try again. If it keeps happening, check back in a few minutes.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3" style={{ fontFamily: "system-ui, sans-serif" }}>
            <button type="button" onClick={reset} className="btn btn-signal">
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full reload is intended here */}
            <a href="/" className="btn">
              Today&apos;s edition
            </a>
          </div>
          {error.digest && <p className="label mt-10">Reference {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
