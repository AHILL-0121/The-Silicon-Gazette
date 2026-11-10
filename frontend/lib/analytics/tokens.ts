import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, isNull, or, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";

import { analyticsApiTokens } from "./schema";

// ---------------------------------------------------------------------------
// Read-only API tokens. A token authorises GET requests to the analytics API
// (never the token routes, the backup, or anything that writes), so a script
// or spreadsheet can pull numbers without the dashboard password. Only the
// SHA-256 is stored; the token itself is shown once, at creation.
// ---------------------------------------------------------------------------

export const TOKEN_PREFIX = "sga_";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface TokenRow {
    id: number;
    name: string;
    prefix: string;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
}

const toRow = (row: typeof analyticsApiTokens.$inferSelect): TokenRow => ({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null
});

export async function listTokens(): Promise<TokenRow[]> {
    const rows = await db.select().from(analyticsApiTokens).orderBy(desc(analyticsApiTokens.createdAt));
    return rows.map(toRow);
}

/** Returns the raw token once; it cannot be recovered afterwards. */
export async function createToken(name: string): Promise<{ token: string; row: TokenRow }> {
    const token = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
    const [row] = await db
        .insert(analyticsApiTokens)
        .values({ name, tokenHash: hashToken(token), prefix: token.slice(0, TOKEN_PREFIX.length + 4) })
        .returning();
    return { token, row: toRow(row) };
}

export async function revokeToken(id: number): Promise<boolean> {
    const rows = await db
        .update(analyticsApiTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(analyticsApiTokens.id, id), isNull(analyticsApiTokens.revokedAt)))
        .returning({ id: analyticsApiTokens.id });
    return rows.length > 0;
}

/** True for a live (not revoked) token. Updates last-used at most every ten minutes. */
export async function verifyApiToken(token: string): Promise<boolean> {
    if (!token.startsWith(TOKEN_PREFIX) || token.length > 128) return false;
    try {
        const hash = hashToken(token);
        const [row] = await db
            .select({ id: analyticsApiTokens.id })
            .from(analyticsApiTokens)
            .where(and(eq(analyticsApiTokens.tokenHash, hash), isNull(analyticsApiTokens.revokedAt)))
            .limit(1);
        if (!row) return false;
        await db
            .update(analyticsApiTokens)
            .set({ lastUsedAt: new Date() })
            .where(
                and(
                    eq(analyticsApiTokens.id, row.id),
                    or(isNull(analyticsApiTokens.lastUsedAt), lt(analyticsApiTokens.lastUsedAt, sql`now() - interval '10 minutes'`))
                )
            );
        return true;
    } catch {
        return false;
    }
}
