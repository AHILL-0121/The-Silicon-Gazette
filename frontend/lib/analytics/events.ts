import { z } from "zod";

// ---------------------------------------------------------------------------
// Event names
// ---------------------------------------------------------------------------
export const EVENT_NAMES = [
    "pageview",
    "page_exit",
    "read_depth",
    "read_complete",
    "story_open",
    "repo_click",
    "source_click",
    "share",
    "palette_open",
    "palette_search",
    "archive_search",
    "archive_filter",
    "theme_toggle",
    "reader_control",
    "edition_nav",
    "section_nav",
    "generate_request"
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

// ---------------------------------------------------------------------------
// Per-event props schemas
// ---------------------------------------------------------------------------
const pageviewProps = z.object({ title: z.string().optional() });
const pageExitProps = z.object({ seconds: z.number().int().nonnegative(), max_depth: z.number().int().min(0).max(100) });
const readDepthProps = z.object({ depth: z.union([z.literal(25), z.literal(50), z.literal(75), z.literal(100)]) });
const readCompleteProps = z.object({ seconds: z.number().int().nonnegative() });
const storyOpenProps = z.object({ section: z.string(), position: z.number().int().nonnegative() });
const repoClickProps = z.object({ repo: z.string() });
const sourceClickProps = z.object({ host: z.string() });
const shareProps = z.object({ method: z.enum(["native", "clipboard"]) });
const paletteOpenProps = z.object({ via: z.enum(["slash", "ctrl_k", "button"]) });
const paletteSearchProps = z.object({ results: z.number().int().nonnegative(), chose: z.boolean() });
const archiveSearchProps = z.object({ results: z.number().int().nonnegative() });
const archiveFilterProps = z.object({ category: z.string() });
const themeToggleProps = z.object({ to: z.enum(["light", "dark"]) });
const readerControlProps = z.object({ size: z.number().int().nonnegative() });
const editionNavProps = z.object({ dir: z.enum(["prev", "next"]) });
const sectionNavProps = z.object({ section: z.string() });
const generateRequestProps = z.object({ trusted: z.boolean(), cached: z.boolean(), status: z.number().int() });

// ---------------------------------------------------------------------------
// Discriminated union — used by the ingestion endpoint
// ---------------------------------------------------------------------------
export const analyticsEventSchema = z.discriminatedUnion("name", [
    z.object({ name: z.literal("pageview"), props: pageviewProps }),
    z.object({ name: z.literal("page_exit"), props: pageExitProps }),
    z.object({ name: z.literal("read_depth"), props: readDepthProps }),
    z.object({ name: z.literal("read_complete"), props: readCompleteProps }),
    z.object({ name: z.literal("story_open"), props: storyOpenProps }),
    z.object({ name: z.literal("repo_click"), props: repoClickProps }),
    z.object({ name: z.literal("source_click"), props: sourceClickProps }),
    z.object({ name: z.literal("share"), props: shareProps }),
    z.object({ name: z.literal("palette_open"), props: paletteOpenProps }),
    z.object({ name: z.literal("palette_search"), props: paletteSearchProps }),
    z.object({ name: z.literal("archive_search"), props: archiveSearchProps }),
    z.object({ name: z.literal("archive_filter"), props: archiveFilterProps }),
    z.object({ name: z.literal("theme_toggle"), props: themeToggleProps }),
    z.object({ name: z.literal("reader_control"), props: readerControlProps }),
    z.object({ name: z.literal("edition_nav"), props: editionNavProps }),
    z.object({ name: z.literal("section_nav"), props: sectionNavProps }),
    z.object({ name: z.literal("generate_request"), props: generateRequestProps })
]);

export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;

// Batch schema used by /api/track
export const trackBatchSchema = z.object({
    events: z.array(analyticsEventSchema).min(1).max(10),
    path: z.string().max(1024),
    sessionId: z.string().max(128),
    device: z.enum(["mobile", "tablet", "desktop"]).optional(),
    viewportW: z.number().int().nonnegative().optional(),
    referrer: z.string().max(1024).optional(),
    utmSource: z.string().max(256).optional(),
    utmMedium: z.string().max(256).optional(),
    utmCampaign: z.string().max(256).optional()
});

export type TrackBatch = z.infer<typeof trackBatchSchema>;
