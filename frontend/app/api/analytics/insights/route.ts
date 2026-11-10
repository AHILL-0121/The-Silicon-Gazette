import { NextResponse } from "next/server";
import { z } from "zod";

import {
    METRIC_KEYS,
    queryAlerts,
    queryAnomalies,
    queryEditionTable,
    queryExplorer,
    queryHeatmap,
    queryMarkers,
    queryMetricCounts,
    queryNavPaths,
    queryNotFound,
    queryPeakCurve,
    queryPipeline,
    queryPreviews,
    queryQuality,
    queryStory
} from "@/lib/analytics/insights";
import { parseFilters } from "@/lib/analytics/filters";
import { isOkSession, requireAnalyticsSession } from "@/lib/analytics/session";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const querySchema = z.object({
    type: z.enum([
        "heatmap", "editions", "peak", "story", "nav", "notfound", "quality", "previews",
        "anomalies", "markers", "pipeline", "metrics", "explorer", "alerts"
    ]),
    from: day.optional(),
    to: day.optional(),
    tz: z.enum(["UTC", "IST"]).default("UTC"),
    slug: z.string().max(200).optional(),
    name: z.string().max(40).optional(),
    path: z.string().max(200).optional(),
    country: z.string().length(2).optional(),
    device: z.enum(["mobile", "tablet", "desktop"]).optional(),
    session: z.string().max(128).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(10_000).default(0)
});

export async function GET(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;

    const params = Object.fromEntries(new URL(req.url).searchParams.entries());
    const parsed = querySchema.safeParse(params);
    if (!parsed.success) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });

    const q = parsed.data;
    const filters = parseFilters(new URL(req.url).searchParams);
    const needsRange = !["quality", "pipeline", "alerts"].includes(q.type);
    if (needsRange && (!q.from || !q.to || q.from > q.to)) {
        return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
    }
    const from = q.from as string;
    const to = q.to as string;

    let data: unknown;
    switch (q.type) {
        case "heatmap": data = await queryHeatmap(from, to, q.tz, filters); break;
        case "editions": data = await queryEditionTable(from, to, filters); break;
        case "peak": data = await queryPeakCurve(from, to, filters); break;
        case "story":
            if (!q.slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });
            data = await queryStory(from, to, q.slug, filters);
            break;
        case "nav": data = await queryNavPaths(from, to, filters); break;
        case "notfound": data = await queryNotFound(from, to); break;
        case "quality": data = await queryQuality(); break;
        case "previews": data = await queryPreviews(from, to); break;
        case "anomalies": data = await queryAnomalies(from, to, filters); break;
        case "markers": data = await queryMarkers(from, to); break;
        case "pipeline": data = await queryPipeline(); break;
        case "metrics": data = { keys: METRIC_KEYS, counts: await queryMetricCounts(from, to) }; break;
        case "alerts": data = await queryAlerts(); break;
        case "explorer":
            data = await queryExplorer(from, to, {
                name: q.name, path: q.path, country: q.country, device: q.device, session: q.session
            }, q.limit, q.offset);
            break;
    }
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
