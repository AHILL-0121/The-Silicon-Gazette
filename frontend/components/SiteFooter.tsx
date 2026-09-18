import Link from "next/link";

/** The one site-wide footer (the page's only contentinfo landmark). */
export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-rule">
      <div className="page-x grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="font-display text-4xl leading-none">
            The <em className="text-signal">Silicon</em> Gazette
          </p>
          <p className="mt-3 max-w-sm font-serif text-lg italic text-ink-soft">All the code that&apos;s fit to print.</p>
        </div>
        <nav aria-label="Footer">
          <p className="label mb-4">Read</p>
          <ul className="space-y-2 text-sm">
            <li>
              <Link className="text-ink-soft hover:text-ink" href="/">
                Today&apos;s edition
              </Link>
            </li>
            <li>
              <Link className="text-ink-soft hover:text-ink" href="/latest">
                Latest printed edition
              </Link>
            </li>
            <li>
              <Link className="text-ink-soft hover:text-ink" href="/archive">
                The archive
              </Link>
            </li>
          </ul>
        </nav>
        <div>
          <p className="label mb-4">How it&apos;s made</p>
          <p className="text-sm leading-relaxed text-ink-soft">
            A new edition is set every day at 00:10 UTC from live web search and written by language models. Stories
            link to their sources; check them before you quote.
          </p>
        </div>
      </div>
      <div className="page-x grid items-center gap-4 border-t border-rule py-5 text-center sm:grid-cols-[1fr_auto_1fr] sm:text-left">
        <p className="label">© The Silicon Gazette · Vol. I</p>
        <DevCredit />
        <p className="label hidden sm:block sm:text-right">
          Press <kbd className="rounded border border-rule px-1">/</kbd> to search
        </p>
      </div>
    </footer>
  );
}

const DEV_LINKS = [
  {
    name: "GitHub",
    label: "AHILL S on GitHub",
    href: "https://github.com/AHILL-0121",
    icon: (
      <path
        fill="currentColor"
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
      />
    )
  },
  {
    name: "LinkedIn",
    label: "AHILL S on LinkedIn",
    href: "https://www.linkedin.com/in/ahill-selvaraj",
    icon: (
      <path
        fill="currentColor"
        d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
      />
    )
  },
  {
    name: "Portfolio",
    label: "AHILL S's portfolio",
    href: "https://sa-portfolio-psi.vercel.app/",
    icon: (
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </g>
    )
  }
];

/** Developer credit with icon links; each icon shows its name on hover or keyboard focus. */
function DevCredit() {
  return (
    <div className="flex items-center justify-center gap-3">
      <p className="label">Dev by AHILL S</p>
      <ul className="flex items-center gap-1">
        {DEV_LINKS.map((link) => (
          <li key={link.name} className="group relative">
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${link.label} (opens in a new tab)`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-ink/5 hover:text-signal focus-visible:text-signal"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                {link.icon}
              </svg>
            </a>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md bg-ink px-2 py-1 font-mono text-[0.6875rem] text-paper opacity-0 transition-all duration-200 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100"
            >
              {link.name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
