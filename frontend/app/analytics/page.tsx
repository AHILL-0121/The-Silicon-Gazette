"use client";

import { useEffect, useState } from "react";
import { LoginForm } from "@/components/analytics/LoginForm";
import { SessionGuard } from "@/components/analytics/SessionGuard";
import { Dashboard } from "@/components/analytics/Dashboard";

const TOKEN_KEY = "sg-analytics-token";

export default function AnalyticsPage() {
    const [token, setToken] = useState<string | null>(null);
    const [checked, setChecked] = useState(false);
    const [logoutReason, setLogoutReason] = useState<string | null>(null);

    // Read token from sessionStorage on mount (never in the initial HTML)
    useEffect(() => {
        try {
            const stored = sessionStorage.getItem(TOKEN_KEY);
            setToken(stored);
        } catch {
            setToken(null);
        }
        setChecked(true);
    }, []);

    function onLogin(t: string) {
        try {
            sessionStorage.setItem(TOKEN_KEY, t);
        } catch {
            // ignore
        }
        setToken(t);
        setLogoutReason(null);
    }

    function onLogout(reason?: string) {
        try {
            sessionStorage.removeItem(TOKEN_KEY);
        } catch {
            // ignore
        }
        setToken(null);
        setLogoutReason(reason ?? null);
    }

    // Blank until we read sessionStorage (prevents flash)
    if (!checked) {
        return (
            <div className="min-h-screen bg-paper flex items-center justify-center">
                <span className="label animate-pulse">Loading…</span>
            </div>
        );
    }

    if (!token) {
        return (
            <main id="main" className="min-h-screen bg-paper flex items-center justify-center px-4" tabIndex={-1}>
                <LoginForm onLogin={onLogin} reason={logoutReason} />
            </main>
        );
    }

    return (
        <main id="main" className="min-h-screen bg-paper" tabIndex={-1}>
            <SessionGuard token={token} onLogout={onLogout}>
                <Dashboard token={token} onLogout={onLogout} />
            </SessionGuard>
        </main>
    );
}
