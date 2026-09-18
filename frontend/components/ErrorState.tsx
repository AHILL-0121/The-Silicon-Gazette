import Link from "next/link";
import type { ReactNode } from "react";

interface ErrorStateProps {
  code?: string;
  title: string;
  body: ReactNode;
  actions?: ReactNode;
  footnote?: ReactNode;
}

/** Full-width message used by 404, error and unavailable pages. */
export function ErrorState({ code, title, body, actions, footnote }: ErrorStateProps) {
  return (
    <section className="page-x flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      {code && (
        <p className="font-display text-[clamp(6rem,22vw,14rem)] italic leading-none text-signal" aria-hidden="true">
          {code}
        </p>
      )}
      <h1 className="mt-2 max-w-3xl font-display text-[clamp(2.4rem,6vw,4.5rem)] leading-[0.95] text-balance">{title}</h1>
      <div className="mt-5 max-w-xl font-serif text-lg text-ink-soft text-pretty">{body}</div>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {actions ?? (
          <>
            <Link href="/" className="btn btn-signal">
              Today&apos;s edition
            </Link>
            <Link href="/archive" className="btn">
              Browse the archive
            </Link>
          </>
        )}
      </div>
      {footnote && <p className="label mt-10">{footnote}</p>}
    </section>
  );
}
