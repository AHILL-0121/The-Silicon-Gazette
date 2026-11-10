/**
 * Replays stored editions through the grounding validator against the Tavily
 * results saved for the same day (search_contexts). Read-only: nothing is
 * written, no model or search API is called.
 *
 *   npx tsx scripts/audit-grounding.ts            # every stored day
 *   npx tsx scripts/audit-grounding.ts 14         # last 14 days
 *   npx tsx scripts/audit-grounding.ts 2026-11-08 # one day, with full detail
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { buildEvidenceIndex } from "../lib/evidence";
import { GroundingError, groundEdition } from "../lib/grounding";
import type { GazetteEdition, SearchTopicBlock } from "../lib/types";

config({ path: ".env.local" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);

  const arg = process.argv[2] ?? "";
  const single = /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : null;
  const limit = single ? 1 : Number(arg) || 1000;

  const rows = (single
    ? await sql`select e.date::text as date, e.content, c.blocks from editions e join search_contexts c on c.date = e.date where e.date = ${single}::date`
    : await sql`select e.date::text as date, e.content, c.blocks from editions e join search_contexts c on c.date = e.date order by e.date desc limit ${limit}`) as Array<{
    date: string;
    content: GazetteEdition;
    blocks: SearchTopicBlock[];
  }>;

  let totalStories = 0;
  let totalDropped = 0;
  let totalTrimmed = 0;
  let totalFallbacks = 0;
  let leadRejected = 0;
  let reposTotal = 0;
  let reposDropped = 0;
  let reposFixed = 0;

  for (const row of rows.reverse()) {
    const index = buildEvidenceIndex(row.blocks);
    totalStories += row.content.stories.length;
    reposTotal += row.content.repos.length;
    try {
      const { edition, report } = groundEdition(row.content, index);
      totalDropped += report.droppedStories.length;
      totalTrimmed += report.trimmedSentences;
      totalFallbacks += report.fallbackSummaries;
      reposDropped += report.droppedRepos.length;
      reposFixed += report.repoFixes.length;
      console.log(
        `${row.date}  stories ${row.content.stories.length} -> ${edition.stories.length}` +
          `  | sentences removed ${report.trimmedSentences}, extractive fallbacks ${report.fallbackSummaries}, headlines replaced ${report.headlinesReplaced}` +
          `  | repos ${row.content.repos.length} -> ${edition.repos.length} (${report.repoFixes.length} fields blanked)` +
          `  | brief ${report.marketBriefReplaced ? "replaced" : "kept"}`
      );
      if (single) {
        for (const drop of report.droppedStories) console.log(`   DROP  ${drop.headline}\n         ${drop.reason}`);
        for (const note of [...report.droppedRepos, ...report.repoFixes]) console.log(`   REPO  ${note}`);
      } else {
        for (const drop of report.droppedStories) console.log(`   drop: ${drop.headline.slice(0, 70)} :: ${drop.reason}`);
      }
    } catch (error) {
      if (!(error instanceof GroundingError)) throw error;
      leadRejected += 1;
      console.log(`${row.date}  LEAD REJECTED: ${error.message}`);
    }
  }

  console.log(
    `\n${rows.length} editions | stories dropped ${totalDropped}/${totalStories} | sentences removed ${totalTrimmed}` +
      ` | extractive fallbacks ${totalFallbacks} | leads rejected ${leadRejected}` +
      ` | repos dropped ${reposDropped}/${reposTotal}, fields blanked ${reposFixed}`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
