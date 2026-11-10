/**
 * Fetches the free news sources (RSS, Hacker News, GitHub) and prints what the
 * models would be shown. No database, no model or Tavily calls.
 *
 *   npx tsx scripts/preview-sources.ts
 */
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { fetchFreeContext } = await import("../lib/free-sources");
  const { buildEvidenceIndex, serializeEvidence } = await import("../lib/evidence");
  const { repoWatchFromBlocks } = await import("../lib/news");

  const started = Date.now();
  const blocks = await fetchFreeContext();
  const index = buildEvidenceIndex(blocks);
  const entries = [...index.values()];
  console.log(`fetched in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  for (const block of blocks) console.log(`  ${block.topic.padEnd(12)} ${block.results.length} results`);
  const byDetail = { low: 0, medium: 0, high: 0 } as Record<string, number>;
  for (const entry of entries) byDetail[entry.detail] += 1;
  console.log(`articles ${entries.filter((e) => e.kind === "article").length}, listings ${entries.filter((e) => e.kind === "listing").length}`);
  console.log(`evidence detail: low ${byDetail.low}, medium ${byDetail.medium}, high ${byDetail.high}`);
  console.log(`prompt size: ~${Math.round(serializeEvidence(blocks, { articlesOnly: true }).length / 4)} tokens per section call\n`);
  for (const entry of entries) {
    console.log(`[${entry.detail.padEnd(6)}] ${entry.title.slice(0, 80)}\n         ${entry.url.slice(0, 90)}\n         ${entry.snippet.slice(0, 110)}`);
  }
  console.log("\nREPO WATCH:", JSON.stringify(repoWatchFromBlocks(blocks, new Set()), null, 1));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
