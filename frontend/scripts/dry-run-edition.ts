/**
 * Full generation run without any database writes: free sources (Tavily only if
 * they fall short) -> Groq -> fact-check, then prints what survived and what was
 * removed. Spends Groq quota.
 *
 *   npx tsx scripts/dry-run-edition.ts
 */
import { config } from "dotenv";

config({ path: ".env.local" });
// db.ts builds its client at import time; the dry run never queries it.
process.env.DATABASE_URL = "postgresql://unused:unused@localhost/unused";

async function main() {
  const { fetchNewsContext, repoWatchFromBlocks } = await import("../lib/news");
  const { buildEvidenceIndex } = await import("../lib/evidence");
  const { generateGazette } = await import("../lib/groq");
  const { verifyEdition } = await import("../lib/edition-service");

  const started = Date.now();
  const context = await fetchNewsContext();
  const index = buildEvidenceIndex(context.blocks);
  console.log(`sources: ${index.size} results (${Date.now() - started} ms)`);

  const raw = await generateGazette("2026-11-09", context.serialized, [], context.articles);
  console.log(`groq: ${raw.stories.length} stories drafted (${((Date.now() - started) / 1000).toFixed(0)} s total)`);

  const { content, report } = verifyEdition(raw, {
    allowedUrls: new Set([...index.keys()]),
    evidenceIndex: index,
    recentUrls: new Set(),
    githubRepos: repoWatchFromBlocks(context.blocks, new Set())
  });

  console.log("\nREMOVED BY FACT-CHECK:", JSON.stringify(report, null, 1));
  console.log(`\nLEAD: ${content.headline.title}\n  ${content.headline.body.replace(/\n+/g, " ").slice(0, 400)}`);
  for (const story of content.stories) {
    console.log(`\n- ${story.headline} [${story.source}]\n  ${story.url}\n  ${story.summary.replace(/\n+/g, " ").slice(0, 300)}`);
  }
  console.log("\nREPOS:", content.repos.map((repo) => `${repo.name} ★${repo.stars} ${repo.language}`).join(" | "));
  console.log("BRIEF:", content.market_brief);
}

main().catch((error) => {
  console.error("FAILED", error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exit(1);
});
