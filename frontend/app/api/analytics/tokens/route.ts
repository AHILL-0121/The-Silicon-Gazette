import { NextResponse } from "next/server";
import { z } from "zod";

import { isMissingTable } from "@/lib/analytics/counters";
import { isOkSession, requireAnalyticsSession } from "@/lib/analytics/session";
import { createToken, listTokens, revokeToken } from "@/lib/analytics/tokens";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_ACTIVE = 10;

function setupNeeded() {
    return NextResponse.json({ available: false }, { headers: NO_STORE });
}

export async function GET(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;
    try {
        return NextResponse.json({ available: true, tokens: await listTokens() }, { headers: NO_STORE });
    } catch (error) {
        if (isMissingTable(error)) return setupNeeded();
        throw error;
    }
}

const createSchema = z.object({ name: z.string().trim().min(1).max(60) });

export async function POST(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "A name of 1 to 60 characters is required" }, { status: 400 });
    try {
        const active = (await listTokens()).filter((t) => !t.revokedAt).length;
        if (active >= MAX_ACTIVE) {
            return NextResponse.json({ error: `At most ${MAX_ACTIVE} active tokens. Revoke one first.` }, { status: 409 });
        }
        const { token, row } = await createToken(parsed.data.name);
        // The only time the token is ever returned.
        return NextResponse.json({ token, row }, { status: 201, headers: NO_STORE });
    } catch (error) {
        if (isMissingTable(error)) return NextResponse.json({ error: "The tokens table does not exist yet. Run drizzle-kit push." }, { status: 503 });
        throw error;
    }
}

export async function DELETE(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const ok = await revokeToken(id);
    return NextResponse.json({ ok }, { status: ok ? 200 : 404, headers: NO_STORE });
}
