/** URL for an archive view; page 1 and empty filters are omitted so each view has one canonical form. */
export function archiveHref(params: { q?: string | null; category?: string | null; page?: number }): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.category) search.set("category", params.category);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const query = search.toString();
  return query ? `/archive?${query}` : "/archive";
}
