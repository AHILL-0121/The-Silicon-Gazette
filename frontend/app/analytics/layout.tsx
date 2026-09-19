import type { Metadata } from "next";

// Rendered per request so Next.js can attach the CSP nonce from middleware.ts
// to its scripts; a prerendered page would carry no nonce and be blocked.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Analytics",
    robots: { index: false, follow: false }
};

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
    return children;
}
