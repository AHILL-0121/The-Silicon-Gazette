import { index, integer, jsonb, pgTable, serial, text, timestamp, date } from "drizzle-orm/pg-core";

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
 */
export const searchContexts = pgTable("search_contexts", {
  date: date("date", { mode: "string" }).primaryKey(),
  blocks: jsonb("blocks").$type<SearchTopicBlock[]>().notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull()
});
