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

/**
 * Page context captured when the event happened, not when the batch was sent:
 * a batch can span a client-side navigation.
 */
const eventContext = {
    path: z.string().max(1024).optional(),
    /** External referrer; set on the landing pageview only. */
    referrer: z.string().max(1024).optional(),
    utmSource: z.string().max(256).optional(),
    utmMedium: z.string().max(256).optional(),
    utmCampaign: z.string().max(256).optional(),
    /** The page rendered the 404 screen. */
    notFound: z.boolean().optional()
};

function eventOf<N extends string, P extends z.ZodTypeAny>(name: N, props: P) {
    return z.object({ name: z.literal(name), props, ...eventContext });
}

export const analyticsEventSchema = z.discriminatedUnion("name", [
    eventOf("pageview", pageviewProps),
    eventOf("page_exit", pageExitProps),
    eventOf("read_depth", readDepthProps),
    eventOf("read_complete", readCompleteProps),
    eventOf("story_open", storyOpenProps),
    eventOf("repo_click", repoClickProps),
    eventOf("source_click", sourceClickProps),
    eventOf("share", shareProps),
    eventOf("palette_open", paletteOpenProps),
    eventOf("palette_search", paletteSearchProps),
    eventOf("archive_search", archiveSearchProps),
    eventOf("archive_filter", archiveFilterProps),
    eventOf("theme_toggle", themeToggleProps),
    eventOf("reader_control", readerControlProps),
    eventOf("edition_nav", editionNavProps),
    eventOf("section_nav", sectionNavProps),
    eventOf("generate_request", generateRequestProps)
]);

export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;

/**
 * Batch envelope used by /api/track. Events are validated one by one against
 * `analyticsEventSchema`, so one malformed event doesn't discard the others.
 * `path` is the fallback for events that carry none.
 */
export const trackBatchSchema = z.object({
    events: z.array(z.unknown()).min(1).max(10),
    path: z.string().max(1024),
    sessionId: z.string().max(128),
    device: z.enum(["mobile", "tablet", "desktop"]).optional(),
    viewportW: z.number().int().nonnegative().optional()
});

export type TrackBatch = z.infer<typeof trackBatchSchema>;
