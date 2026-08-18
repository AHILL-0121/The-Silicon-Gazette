import { index, integer, jsonb, pgTable, serial, text, timestamp, date } from "drizzle-orm/pg-core";

import type { GazetteEdition } from "./types";

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