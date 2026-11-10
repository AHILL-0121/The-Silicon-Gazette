// Client-safe list of the counts custom metrics can be built from.
// The server computes them in lib/analytics/insights.ts (queryMetricCounts).

export const METRIC_KEYS = [
    "views", "visitors", "sessions", "completions", "shares", "repo_clicks", "source_clicks",
    "story_opens", "deep_sessions", "palette_opens", "archive_searches", "exits_seconds"
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRIC_LABELS: Record<MetricKey, string> = {
    views: "Page views",
    visitors: "Visitor-days",
    sessions: "Sessions",
    completions: "Finished reads",
    shares: "Shares",
    repo_clicks: "Repo clicks",
    source_clicks: "Source-link clicks",
    story_opens: "Story opens",
    deep_sessions: "Sessions that scrolled 75%+",
    palette_opens: "Command palette opens",
    archive_searches: "Archive searches",
    exits_seconds: "Total reading seconds"
};
