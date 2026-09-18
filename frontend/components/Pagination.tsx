import Link from "next/link";

interface PaginationProps {
  page: number;
  totalPages: number;
  href: (page: number) => string;
  label?: string;
}

/** Page numbers around the current page, with the first and last always shown. */
function pageWindow(page: number, totalPages: number): Array<number | "gap"> {
  const pages = new Set([1, totalPages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= totalPages));
  const sorted = [...pages].sort((a, b) => a - b);
  const result: Array<number | "gap"> = [];
  sorted.forEach((n, index) => {
    if (index > 0 && n - sorted[index - 1] > 1) result.push("gap");
    result.push(n);
  });
  return result;
}

/** Server-rendered page links (real URLs, so crawlers and no-JS readers can page too). */
export function Pagination({ page, totalPages, href, label = "Pages" }: PaginationProps) {
  if (totalPages <= 1) return null;

  const edge = (target: number, text: string, rel: "prev" | "next") =>
    target >= 1 && target <= totalPages ? (
      <Link href={href(target)} rel={rel} className="btn px-4">
        {text}
      </Link>
    ) : (
      <span aria-hidden="true" className="btn pointer-events-none px-4 opacity-35">
        {text}
      </span>
    );

  return (
    <nav aria-label={label} className="mt-14 flex flex-wrap items-center justify-center gap-2">
      {edge(page - 1, "← Newer", "prev")}
      <ol className="flex items-center gap-1">
        {pageWindow(page, totalPages).map((item, index) =>
          item === "gap" ? (
            <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-muted">
              …
            </li>
          ) : (
            <li key={item}>
              <Link
                href={href(item)}
                aria-current={item === page ? "page" : undefined}
                aria-label={`Page ${item}`}
                className={`inline-flex h-10 min-w-10 items-center justify-center rounded-full px-3 font-mono text-sm transition-colors ${
                  item === page ? "bg-ink text-paper" : "text-ink-soft hover:bg-ink/5 hover:text-ink"
                }`}
              >
                {item}
              </Link>
            </li>
          )
        )}
      </ol>
      {edge(page + 1, "Older →", "next")}
    </nav>
  );
}
