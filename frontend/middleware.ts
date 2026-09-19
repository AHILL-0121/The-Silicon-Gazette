import { NextResponse, type NextRequest } from "next/server";

import { THEME_SCRIPT } from "@/lib/theme-script";

// ---------------------------------------------------------------------------
// Nonce-based Content-Security-Policy for the private /analytics dashboard.
//
// Next.js reads the nonce from the request's CSP header and adds it to its own
// scripts, which is why /analytics renders dynamically (app/analytics/layout).
// The root layout's inline theme script is static, so it is allowed by hash:
// reading the nonce there would force every public page to render dynamically.
// ---------------------------------------------------------------------------

let themeHash: Promise<string> | null = null;

function themeScriptHash(): Promise<string> {
    themeHash ??= crypto.subtle
        .digest("SHA-256", new TextEncoder().encode(THEME_SCRIPT))
        .then((digest) => `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`);
    return themeHash;
}

export async function middleware(request: NextRequest) {
    const nonce = btoa(crypto.randomUUID());
    const dev = process.env.NODE_ENV === "development";

    const csp = [
        "default-src 'self'",
        // React's dev tooling needs eval; production never does.
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${await themeScriptHash()}${dev ? " 'unsafe-eval'" : ""}`,
        // Inline style attributes (charts, animations) carry no script risk.
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        ...(dev ? [] : ["upgrade-insecure-requests"])
    ].join("; ");

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", csp);
    return response;
}

export const config = {
    matcher: ["/analytics", "/analytics/:path*"]
};
