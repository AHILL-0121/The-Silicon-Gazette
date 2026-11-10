import type { Metadata } from "next";

// Rendered per request so Next.js can attach the CSP nonce from middleware.ts
// to its scripts; a prerendered page would carry no nonce and be blocked.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Analytics",
    robots: { index: false, follow: false },
    // Lets the dashboard be added to a phone's home screen as its own app.
    manifest: "/analytics.webmanifest",
    appleWebApp: { capable: true, title: "Analytics", statusBarStyle: "default" }
};

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
    return children;
}
