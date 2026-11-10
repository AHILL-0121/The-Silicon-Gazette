import { NextResponse } from "next/server";
import { z } from "zod";

import { addAnnotation, deleteAnnotation, listAnnotations } from "@/lib/analytics/annotations";
import { isMissingTable } from "@/lib/analytics/counters";
import { isOkSession, requireAnalyticsSession } from "@/lib/analytics/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function GET(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;
    const sp = new URL(req.url).searchParams;
    const range = z.object({ from: day, to: day }).safeParse({ from: sp.get("from"), to: sp.get("to") });
    if (!range.success) return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
    try {
        return NextResponse.json({ available: true, annotations: await listAnnotations(range.data.from, range.data.to) }, { headers: NO_STORE });
    } catch (error) {
        if (isMissingTable(error)) return NextResponse.json({ available: false, annotations: [] }, { headers: NO_STORE });
        throw error;
    }
}

const createSchema = z.object({ day, label: z.string().trim().min(1).max(120) });

export async function POST(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success || Number.isNaN(Date.parse(`${parsed.data.day}T00:00:00Z`))) {
        return NextResponse.json({ error: "A date and a label of 1 to 120 characters are required" }, { status: 400 });
    }
    try {
        return NextResponse.json(await addAnnotation(parsed.data.day, parsed.data.label), { status: 201, headers: NO_STORE });
    } catch (error) {
        if (isMissingTable(error)) return NextResponse.json({ error: "The annotations table does not exist yet. Run drizzle-kit push." }, { status: 503 });
        throw error;
    }
}

export async function DELETE(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const ok = await deleteAnnotation(id);
    return NextResponse.json({ ok }, { status: ok ? 200 : 404, headers: NO_STORE });
}
