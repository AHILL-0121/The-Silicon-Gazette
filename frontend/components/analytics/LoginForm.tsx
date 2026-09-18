"use client";

import { useState } from "react";
import { setOptOut } from "@/lib/analytics/client";

const OPT_OUT_KEY = "sg-analytics-optout";

interface LoginFormProps {
    onLogin: (token: string) => void;
    reason?: string | null;
}

export function LoginForm({ onLogin, reason }: LoginFormProps) {
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(reason ?? null);
    const [loading, setLoading] = useState(false);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        if (!password || loading) return;
        setError(null);
        setLoading(true);

        try {
            const res = await fetch("/api/analytics/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password })
            });

            if (res.ok) {
                const data = (await res.json()) as { token: string };
                // Set owner opt-out so login visits aren't tracked
                setOptOut(true);
                onLogin(data.token);
            } else if (res.status === 429) {
                const data = (await res.json()) as { error: string };
                setError(data.error ?? "Too many attempts. Please wait 15 minutes.");
            } else if (res.status === 503) {
                setError("Analytics unavailable. Redis may be down.");
            } else {
                const data = (await res.json()) as { error: string };
                setError(data.error ?? "Incorrect password.");
            }
        } catch {
            setError("Network error. Check your connection.");
        } finally {
            setLoading(false);
        }
    }

    function excludeBrowser() {
        try {
            localStorage.setItem(OPT_OUT_KEY, "1");
        } catch {
            // ignore
        }
        alert("This browser is now excluded from analytics.");
    }

    return (
        <div className="w-full max-w-sm">
            {/* Masthead */}
            <div className="mb-8 text-center">
                <div className="inline-flex items-center gap-2 mb-3">
                    <div className="h-px w-8 bg-signal" />
                    <span className="label text-signal">Private</span>
                    <div className="h-px w-8 bg-signal" />
                </div>
                <h1 className="font-display text-4xl">Analytics</h1>
                <p className="mt-2 text-sm text-muted font-sans">The Silicon Gazette · Owner access</p>
            </div>

            <form onSubmit={submit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                    <label htmlFor="analytics-password" className="label">
                        Password
                    </label>
                    <input
                        id="analytics-password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your analytics password"
                        className="h-11 w-full rounded-xl border border-rule bg-surface px-4 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none transition-colors"
                        disabled={loading}
                        required
                    />
                </div>

                {error && (
                    <div
                        role="alert"
                        className="rounded-xl border border-signal/30 bg-signal/5 px-4 py-3 text-sm text-signal"
                    >
                        {error}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={loading || !password}
                    className="btn btn-signal disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {loading ? (
                        <span className="flex items-center gap-2">
                            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-signal-ink/30 border-t-signal-ink" />
                            Signing in…
                        </span>
                    ) : (
                        "Sign in"
                    )}
                </button>
            </form>

            <p className="mt-8 text-center">
                <button
                    type="button"
                    onClick={excludeBrowser}
                    className="text-xs text-muted underline underline-offset-2 hover:text-ink transition-colors"
                >
                    Exclude this browser from analytics
                </button>
            </p>
        </div>
    );
}
