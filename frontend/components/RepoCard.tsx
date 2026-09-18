import type { RepoView } from "@/lib/edition-view";

const LANGUAGE_COLORS: Record<string, string> = {
  python: "#3572A5",
  typescript: "#3178c6",
  javascript: "#f1e05a",
  rust: "#dea584",
  go: "#00ADD8",
  "c++": "#f34b7d",
  c: "#555555",
  java: "#b07219",
  swift: "#F05138",
  kotlin: "#A97BFF",
  ruby: "#701516",
  shell: "#89e051",
  zig: "#ec915c"
};

/** A trending repository, styled as a terminal window. Links to GitHub. */
export function RepoCard({ repo, rank }: { repo: RepoView; rank: number }) {
  const [owner, name] = repo.name.split("/");
  const color = repo.languageLabel ? LANGUAGE_COLORS[repo.languageLabel.toLowerCase()] : undefined;
  return (
    <div data-reveal>
      <article className="spotlight group relative flex h-full flex-col overflow-hidden rounded-2xl border border-rule bg-surface transition-[transform,border-color] duration-300 hover:-translate-y-1 hover:border-ink/40 focus-within:border-ink/40">
        <div className="flex items-center gap-1.5 border-b border-rule px-4 py-2.5" aria-hidden="true">
          <span className="h-2 w-2 rounded-full bg-rule" />
          <span className="h-2 w-2 rounded-full bg-rule" />
          <span className="h-2 w-2 rounded-full bg-rule" />
          <span className="ml-auto font-mono text-[0.6875rem] text-muted">#{rank}</span>
        </div>
        <div className="flex flex-1 flex-col p-5">
          <p className="font-mono text-xs text-muted">
            <span aria-hidden="true" className="text-signal">$ </span>
            {owner} /
          </p>
          <h3 className="mt-1 break-words font-mono text-lg font-semibold leading-tight">
            <a
              href={repo.href}
              target="_blank"
              rel="noopener noreferrer"
              className="stretched-link focus:outline-none group-hover:text-signal"
              data-track="repo_click"
              data-track-repo={repo.name}
            >
              {name}
              <span className="sr-only"> by {owner} on GitHub (opens in a new tab)</span>
            </a>
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">{repo.description}</p>
          <p className="mt-auto flex items-center gap-4 pt-5 font-mono text-xs text-muted">
            {repo.starsLabel && (
              <span>
                <span aria-hidden="true">★ </span>
                <span className="sr-only">Stars: </span>
                {repo.starsLabel}
              </span>
            )}
            {repo.languageLabel && (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-muted" style={color ? { background: color } : undefined} />
                {repo.languageLabel}
              </span>
            )}
            <span aria-hidden="true" className="ml-auto text-signal">↗</span>
          </p>
        </div>
      </article>
    </div>
  );
}
