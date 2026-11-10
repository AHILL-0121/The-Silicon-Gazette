import { createSign } from "node:crypto";

import { siteUrl } from "@/lib/site";

// ---------------------------------------------------------------------------
// Google Search Console (read-only), through a service account.
//
// Setup: create a service account in Google Cloud, enable the "Google Search
// Console API", add the account's email as a user on the Search Console
// property, then set GSC_SERVICE_ACCOUNT_JSON (the key file, raw or base64)
// and, if the property is not the site URL, GSC_SITE_URL ("sc-domain:example.com"
// for a domain property). Nothing here is sent to Google except the query.
// ---------------------------------------------------------------------------

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

interface ServiceAccount {
    client_email: string;
    private_key: string;
}

function readServiceAccount(): ServiceAccount | null {
    const raw = process.env.GSC_SERVICE_ACCOUNT_JSON?.trim();
    if (!raw) return null;
    try {
        const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
        const parsed = JSON.parse(text) as Partial<ServiceAccount>;
        if (!parsed.client_email || !parsed.private_key) return null;
        // .env files often hold the key with literal \n sequences.
        return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, "\n") };
    } catch {
        return null;
    }
}

export function isSearchConsoleConfigured(): boolean {
    return readServiceAccount() !== null;
}

export function searchConsoleProperty(): string {
    return process.env.GSC_SITE_URL?.trim() || `${siteUrl().replace(/\/$/, "")}/`;
}

const b64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

let cachedToken: { value: string; expires: number } | null = null;

async function accessToken(account: ServiceAccount): Promise<string> {
    if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
        JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })
    )}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key);
    const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signature)}` }),
        signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new SearchConsoleError("Google rejected the service account key", response.status);
    const data = (await response.json()) as { access_token: string; expires_in: number };
    cachedToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
    return data.access_token;
}

export class SearchConsoleError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

interface ApiRow {
    keys?: string[];
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}

async function query(token: string, body: Record<string, unknown>): Promise<ApiRow[]> {
    const property = encodeURIComponent(searchConsoleProperty());
    const response = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${property}/searchAnalytics/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000)
    });
    if (response.status === 403) {
        throw new SearchConsoleError("The service account has no access to this property. Add its email as a user in Search Console.", 403);
    }
    if (!response.ok) throw new SearchConsoleError(`Search Console returned HTTP ${response.status}`, response.status);
    return ((await response.json()) as { rows?: ApiRow[] }).rows ?? [];
}

export interface SearchConsoleResult {
    configured: true;
    property: string;
    totals: { clicks: number; impressions: number; ctr: number; position: number };
    queries: { query: string; clicks: number; impressions: number; ctr: number; position: number }[];
    pages: { page: string; clicks: number; impressions: number; ctr: number; position: number }[];
    daily: { day: string; clicks: number; impressions: number }[];
    /** Search Console data trails real time by about two days. */
    note: string;
}

const cache = new Map<string, { at: number; value: SearchConsoleResult }>();

export async function querySearchConsole(from: string, to: string): Promise<SearchConsoleResult | { configured: false }> {
    const account = readServiceAccount();
    if (!account) return { configured: false };

    const key = `${searchConsoleProperty()}|${from}|${to}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;

    const token = await accessToken(account);
    const base = { startDate: from, endDate: to };
    const [totals, queries, pages, daily] = await Promise.all([
        query(token, { ...base }),
        query(token, { ...base, dimensions: ["query"], rowLimit: 15 }),
        query(token, { ...base, dimensions: ["page"], rowLimit: 10 }),
        query(token, { ...base, dimensions: ["date"], rowLimit: 400 })
    ]);

    const t = totals[0];
    const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
    const value: SearchConsoleResult = {
        configured: true,
        property: searchConsoleProperty(),
        totals: { clicks: t?.clicks ?? 0, impressions: t?.impressions ?? 0, ctr: round((t?.ctr ?? 0) * 100, 2), position: round(t?.position ?? 0, 1) },
        queries: queries.map((r) => ({ query: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions, ctr: round(r.ctr * 100, 1), position: round(r.position, 1) })),
        pages: pages.map((r) => ({ page: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions, ctr: round(r.ctr * 100, 1), position: round(r.position, 1) })),
        daily: daily.map((r) => ({ day: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions })).sort((a, b) => a.day.localeCompare(b.day)),
        note: "Search Console data trails real time by about two days, so the last days of the range may be empty."
    };
    cache.set(key, { at: Date.now(), value });
    return value;
}
