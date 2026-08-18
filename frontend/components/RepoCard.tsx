import type { Repo } from "@/lib/types";

export function RepoCard({ repo }: { repo: Repo }) {
  return (
    <article className="repo-item">
      <h3 className="repo-name">{repo.name}</h3>
      <p className="repo-desc">{repo.description}</p>
      <p className="repo-meta">
        <span className="repo-star">*</span> {repo.stars}
        {repo.language ? ` - ${repo.language}` : ""}
      </p>
    </article>
  );
}