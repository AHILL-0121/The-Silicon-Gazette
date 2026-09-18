/**
 * Runs the full generation pipeline once and prints a quality report, without
 * touching the database (the in-memory store is used). Spends API quota.
 *
 *   npx tsx scripts/verify-pipeline.ts          # Groq, as in production
 *   npx tsx scripts/verify-pipeline.ts gemini   # force the Gemini fallback
 */
import { config } from "dotenv";

config({ path: ".env.local" });
delete process.env.DATABASE_URL;
delete process.env.UPSTASH_REDIS_REST_URL;
const provider = process.argv[2] === "gemini" ? "gemini" : "groq";
if (provider === "gemini") {
  process.env.GROQ_API_KEY = "invalid-key-to-force-fallback";
  process.env.GROQ_API_KEYS = "";
}

async function main() {
  const { generateEdition } = await import("../lib/edition-service");
  const { buildEditionView } = await import("../lib/edition-view");
  const { GazetteEditionSchema } = await import("../lib/gazette");
  const { toEditionDate } = await import("../lib/date");

  const record = await generateEdition(toEditionDate());
  const content = record.content;
  const view = buildEditionView(content, record.date);
  console.log(
    JSON.stringify(
      {
        provider,
        model: record.model,
        latencySeconds: Math.round((record.latency_ms ?? 0) / 1000),
        schemaValid: GazetteEditionSchema.safeParse(content).success,
        leadTitle: content.headline.title,
        stories: content.stories.length,
        storiesShownAfterDedupe: view.stories.length,
        storiesWithSourceUrl: content.stories.filter((story) => story.url).length,
        categories: [...new Set(content.stories.map((story) => story.category))],
        repos: content.repos.map((repo) => `${repo.name} ★${repo.stars} ${repo.language}`),
        marketBrief: content.market_brief
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("FAILED", error instanceof Error ? error.message : error);
  process.exit(1);
});
