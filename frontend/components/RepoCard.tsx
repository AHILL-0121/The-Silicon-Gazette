import type { RepoView } from "@/lib/edition-view";

export function RepoCard({ repo }: { repo: RepoView }) {
  return (
    <article className="repo-item">
      <h3 className="repo-name">
        <a href={repo.href} target="_blank" rel="noopener noreferrer" className="headline-link">
          {repo.name}
        </a>
      </h3>
      <p className="repo-desc">{repo.description}</p>
      <p className="repo-meta">
        {repo.starsLabel && (
          <span>
            <span className="repo-star" aria-hidden="true">★</span>{" "}
            {repo.starsLabel}
          </span>
        )}
        {repo.starsLabel && repo.languageLabel && " · "}
        {repo.languageLabel && <span>{repo.languageLabel}</span>}
      </p>
    </article>
  );
}