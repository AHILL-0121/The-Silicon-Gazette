import {
    bigserial,
    char,
    date,
    index,
    integer,
    jsonb,
    pgTable,
    primaryKey,
    smallint,
    text,
    timestamp
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Raw event log — kept forever (D6)
// ---------------------------------------------------------------------------
export const events = pgTable(
    "events",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
        name: text("name").notNull(),
        path: text("path").notNull(),
        pageType: text("page_type").notNull(), // home|edition|story|archive|latest|404|other
        editionDate: date("edition_date"),
        storySlug: text("story_slug"),
        visitorHash: text("visitor_hash").notNull(),
        sessionId: text("session_id").notNull(),
        referrerHost: text("referrer_host"),
        utmSource: text("utm_source"),
        utmMedium: text("utm_medium"),
        utmCampaign: text("utm_campaign"),
        country: char("country", { length: 2 }),
        device: text("device").notNull(), // mobile|tablet|desktop
        viewportW: smallint("viewport_w"),
        props: jsonb("props").notNull().default({})
    },
    (table) => ({
        tsIdx: index("idx_events_ts").on(table.ts),
        nameTsIdx: index("idx_events_name_ts").on(table.name, table.ts),
        editionIdx: index("idx_events_edition").on(table.editionDate),
        sessionTsIdx: index("idx_events_session_ts").on(table.sessionId, table.ts)
    })
);

// ---------------------------------------------------------------------------
// Daily rollups — rebuilt idempotently by the nightly job
// ---------------------------------------------------------------------------

/** One row per (day, path). Views/visitors/sessions count pageviews only. */
export const dailyPageStats = pgTable(
    "daily_page_stats",
    {
        day: date("day").notNull(),
        path: text("path").notNull(),
        pageType: text("page_type").notNull(),
        editionDate: date("edition_date"),
        storySlug: text("story_slug"),
        views: integer("views").notNull().default(0),
        visitors: integer("visitors").notNull().default(0),
        sessions: integer("sessions").notNull().default(0),
        completions: integer("completions").notNull().default(0),
        shares: integer("shares").notNull().default(0)
    },
    (table) => ({
        pk: primaryKey({ columns: [table.day, table.path] })
    })
);

/** One row per (day, event name, optional key prop). */
export const dailyEventStats = pgTable(
    "daily_event_stats",
    {
        day: date("day").notNull(),
        name: text("name").notNull(),
        key: text("key").notNull().default(""),
        count: integer("count").notNull().default(0),
        visitors: integer("visitors").notNull().default(0)
    },
    (table) => ({
        pk: primaryKey({ columns: [table.day, table.name, table.key] })
    })
);

/**
 * One row per rolled-up day, written even when the day had no traffic. Its
 * presence marks the day as rolled up, so queries know to read rollups for it.
 * Session counts are distinct per UTC day (a session crossing midnight counts
 * on both days), which is exactly what the raw-event queries compute too.
 */
export const dailySessionStats = pgTable("daily_session_stats", {
    day: date("day").primaryKey(),
    views: integer("views").notNull().default(0),
    visitors: integer("visitors").notNull().default(0),
    sessions: integer("sessions").notNull().default(0),
    storySessions: integer("story_sessions").notNull().default(0),
    completeSessions: integer("complete_sessions").notNull().default(0),
    openSessions: integer("open_sessions").notNull().default(0),
    deepSessions: integer("deep_sessions").notNull().default(0),
    shareSessions: integer("share_sessions").notNull().default(0)
});

/** One row per (day, dimension, value). */
export const dailyDimStats = pgTable(
    "daily_dim_stats",
    {
        day: date("day").notNull(),
        dim: text("dim").notNull(), // referrer|country|device|utm_source
        value: text("value").notNull(),
        views: integer("views").notNull().default(0),
        visitors: integer("visitors").notNull().default(0)
    },
    (table) => ({
        pk: primaryKey({ columns: [table.day, table.dim, table.value] })
    })
);
