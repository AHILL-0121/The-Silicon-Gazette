import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, date } from "drizzle-orm/pg-core";

import type { GazetteEdition, SearchTopicBlock } from "./types";

export const editions = pgTable(
  "editions",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "string" }).notNull().unique(),
    issueNum: integer("issue_num").notNull(),
    content: jsonb("content").$type<GazetteEdition>().notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    model: text("model").notNull().default("llama-3.3-70b-versatile"),
    latencyMs: integer("latency_ms")
  },
  (table) => ({
    dateIndex: index("idx_editions_date").on(table.date)
  })
);

/**
 * Tavily results for a day. Saved before the models run, so a retry after a
 * model failure reuses them instead of searching (and spending quota) again.
 * Kept forever: they are the evidence each edition can be audited against
 * (scripts/audit-grounding.ts).
 */
export const searchContexts = pgTable("search_contexts", {
  date: date("date", { mode: "string" }).primaryKey(),
  blocks: jsonb("blocks").$type<SearchTopicBlock[]>().notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull()
});

/**
 * One row per paid API call the pipeline makes (Groq, Gemini, Tavily). Written
 * best-effort after each call; token counts are whatever the provider reported.
 */
export const apiUsage = pgTable(
  "api_usage",
  {
    id: serial("id").primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
    provider: text("provider").notNull(), // groq | gemini | tavily
    model: text("model").notNull().default(""),
    kind: text("kind").notNull().default(""), // generate | search | analytics
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    /** Tavily credits; null for token-billed providers. */
    credits: integer("credits"),
    latencyMs: integer("latency_ms"),
    ok: boolean("ok").notNull().default(true)
  },
  (table) => ({
    tsIdx: index("idx_api_usage_ts").on(table.ts)
  })
);

/**
 * What the grounding pass did to one edition: the fact-check history. Until
 * now this was only logged. `sources` is [{host, kept, dropped}] and feeds the
 * source-reliability table.
 */
export const factChecks = pgTable("fact_checks", {
  date: date("date", { mode: "string" }).primaryKey(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
  model: text("model").notNull().default(""),
  storiesIn: integer("stories_in").notNull().default(0),
  storiesOut: integer("stories_out").notNull().default(0),
  droppedStories: integer("dropped_stories").notNull().default(0),
  trimmedSentences: integer("trimmed_sentences").notNull().default(0),
  headlinesReplaced: integer("headlines_replaced").notNull().default(0),
  fallbackSummaries: integer("fallback_summaries").notNull().default(0),
  droppedRepos: integer("dropped_repos").notNull().default(0),
  repoFixes: integer("repo_fixes").notNull().default(0),
  sourceRelabeled: integer("source_relabeled").notNull().default(0),
  marketBriefReplaced: boolean("market_brief_replaced").notNull().default(false),
  sources: jsonb("sources").$type<Array<{ host: string; kept: number; dropped: number }>>().notNull().default([]),
  dropped: jsonb("dropped").$type<Array<{ headline: string; reason: string }>>().notNull().default([])
});
