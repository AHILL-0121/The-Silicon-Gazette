import { formatDisplayDate } from "@/lib/date";
import { readArchivePage } from "@/lib/edition-service";
import { logServerError } from "@/lib/logger";
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export const revalidate = 3600;

/**
 * llms.txt (https://llmstxt.org): a plain-Markdown map of the site for
 * language models and AI crawlers, with the most recent editions.
 */
export async function GET() {
  let recent = "";
  let exampleDate = "YYYY-MM-DD";
  try {
    const { items } = await readArchivePage({ page: 1 });
    if (items[0]) exampleDate = items[0].date;
    recent = items
      .map((edition) => `- [${formatDisplayDate(edition.date)}: ${edition.title}](${absoluteUrl(`/gazette/${edition.date}`)}): ${edition.deck}`)
      .join("\n");
  } catch (error) {
    logServerError("llms.recent_failed", error);
  }

  const body = `# ${SITE_NAME}

> ${SITE_DESCRIPTION} One edition is published per day (UTC): a lead story, up to 12 stories across AI, tech, startups, open source, hardware and security, trending GitHub repositories, and a market brief.

Stories are written by a language model from live web search results, and each story links to the original reporting it is based on. When citing a fact, prefer the original source linked from the story.

## Pages

- [Today's edition](${absoluteUrl("/")}): redirects to the current date, \`/gazette/YYYY-MM-DD\`
- [Latest printed edition](${absoluteUrl("/latest")}): redirects to the newest edition that exists
- [Archive](${absoluteUrl("/archive")}): every edition, newest first, searchable with \`?q=\`
- [Story pages](${absoluteUrl("/archive")}): \`/gazette/YYYY-MM-DD/story/<slug>\`, linked from each edition

## Data

- [Edition JSON](${absoluteUrl(`/api/gazette/${exampleDate}`)}): \`GET /api/gazette/YYYY-MM-DD\` returns a stored edition (read-only; 404 if that day wasn't printed)
- [Sitemap](${absoluteUrl("/sitemap.xml")}): every edition and story URL

## Recent editions

${recent || "- See the archive."}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600"
    }
  });
}
