/**
 * Renders schema.org JSON-LD. Headlines and summaries come from a language
 * model, so `<` is escaped: text like "</script>" can't close the tag early.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
