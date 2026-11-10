import { NextResponse } from "next/server";
import { z } from "zod";

import { queryBotFilter } from "@/lib/analytics/counters";
import { parseFilters } from "@/lib/analytics/filters";
import { isSearchConsoleConfigured, querySearchConsole, SearchConsoleError } from "@/lib/analytics/gsc";
import { queryFactChecks, queryQualityEngagement, queryReliability, queryUsage } from "@/lib/analytics/production";
import { isOkSession, requireAnalyticsSession } from "@/lib/analytics/session";
import { queryVitals } from "@/lib/analytics/vitals";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const querySchema = z.object({
    type: z.enum(["vitals", "botfilter", "searchconsole", "usage", "factchecks", "reliability", "quality"]),
    from: day.optional(),
    to: day.optional()
});

/** Read-only data for the newer dashboard panels. A null result means the table does not exist yet. */
export async function GET(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;

    const searchParams = new URL(req.url).searchParams;
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams.entries()));
    if (!parsed.success) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });

    const { type, from, to } = parsed.data;
    const needsRange = !["factchecks", "reliability", "quality"].includes(type);
    if (needsRange && (!from || !to || from > to)) {
        return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
    }

    const headers = { "Cache-Control": "no-store" };
    try {
        switch (type) {
            case "vitals":
                return NextResponse.json(await queryVitals(from as string, to as string, parseFilters(searchParams)), { headers });
            case "botfilter": {
                const data = await queryBotFilter(from as string, to as string);
                return NextResponse.json(data ?? { available: false }, { headers });
            }
            case "searchconsole":
                return NextResponse.json(await querySearchConsole(from as string, to as string), { headers });
            case "usage": {
                const data = await queryUsage(from as string, to as string);
                return NextResponse.json(data ?? { available: false }, { headers });
            }
            case "factchecks": {
                const data = await queryFactChecks();
                return NextResponse.json(data ?? { available: false }, { headers });
            }
            case "reliability": {
                const data = await queryReliability();
                return NextResponse.json(data ? { sources: data } : { available: false }, { headers });
            }
            case "quality": {
                const data = await queryQualityEngagement();
                return NextResponse.json(data ?? { available: false }, { headers });
            }
        }
    } catch (error) {
        if (error instanceof SearchConsoleError) {
            return NextResponse.json({ configured: isSearchConsoleConfigured(), error: error.message }, { status: 502, headers });
        }
        throw error;
    }
}
