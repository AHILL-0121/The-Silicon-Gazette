"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const HEARTBEAT_MS = 60_000;
const WARN_MS = 19 * 60_000;
const LOGOUT_MS = 20 * 60_000;

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

interface SessionGuardProps {
    token: string;
    onLogout: (reason?: string) => void;
    children: ReactNode;
}

export function SessionGuard({ token, onLogout, children }: SessionGuardProps) {
    const [showWarning, setShowWarning] = useState(false);
    const activeRef = useRef(false);
    const lastActivityRef = useRef(Date.now());
    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const logout = useCallback(
        (reason: string) => {
            if (heartbeatRef.current) clearInterval(heartbeatRef.current);
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
            if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
            onLogout(reason);
        },
        [onLogout]
    );

    const sendHeartbeat = useCallback(
        async (active: boolean) => {
            try {
                const res = await fetch("/api/analytics/session/heartbeat", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({ active })
                });

                if (res.status === 401) {
                    const data = (await res.json()) as { error?: string };
                    logout(
                        data.error === "session_idle"
                            ? "Signed out after 20 minutes of inactivity."
                            : data.error === "session_closed"
                                ? "Session ended (tab was closed)."
                                : "Your session has expired."
                    );
                }
            } catch {
                // Network error — keep the session locally, try again next tick
            }
        },
        [token, logout]
    );

    // Reset idle timers
    const resetTimers = useCallback(() => {
        if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        setShowWarning(false);

        warnTimerRef.current = setTimeout(() => {
            setShowWarning(true);
        }, WARN_MS);

        idleTimerRef.current = setTimeout(() => {
            logout("Signed out after 20 minutes of inactivity.");
        }, LOGOUT_MS);
    }, [logout]);

    useEffect(() => {
        // Activity tracking
        const onActivity = () => {
            activeRef.current = true;
            lastActivityRef.current = Date.now();
            resetTimers();
        };
        ACTIVITY_EVENTS.forEach((ev) => {
            window.addEventListener(ev, onActivity, { passive: true });
        });

        // Initial heartbeat on mount (verify session still good)
        sendHeartbeat(false);

        // Periodic heartbeat
        heartbeatRef.current = setInterval(() => {
            const active = activeRef.current;
            activeRef.current = false;
            sendHeartbeat(active);
        }, HEARTBEAT_MS);

        // Start idle timers
        resetTimers();

        // pagehide — leave beacon (sendBeacon can't send headers; token in body)
        const onPageHide = () => {
            navigator.sendBeacon(
                "/api/analytics/session/leave",
                new Blob([JSON.stringify({ token })], { type: "application/json" })
            );
        };
        window.addEventListener("pagehide", onPageHide);

        return () => {
            ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity));
            window.removeEventListener("pagehide", onPageHide);
            if (heartbeatRef.current) clearInterval(heartbeatRef.current);
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
            if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
        };
    }, [token, sendHeartbeat, resetTimers]);

    async function handleLogout() {
        try {
            await fetch("/api/analytics/logout", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch {
            // ignore
        }
        logout("Signed out.");
    }

    return (
        <>
            {children}

            {/* Idle warning dialog */}
            {showWarning && (
                <div
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby="idle-warning-title"
                    aria-describedby="idle-warning-desc"
                    className="fixed inset-0 z-[90] flex items-center justify-center px-4"
                >
                    <div className="absolute inset-0 bg-ink/50 backdrop-blur-sm" aria-hidden="true" />
                    <div className="relative w-full max-w-sm rounded-2xl border border-rule bg-surface p-6 shadow-2xl">
                        <h2 id="idle-warning-title" className="font-display text-2xl">
                            Still reading?
                        </h2>
                        <p id="idle-warning-desc" className="mt-2 text-sm text-ink-soft">
                            You&apos;ll be signed out in about 60 seconds due to inactivity.
                        </p>
                        <div className="mt-5 flex gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    resetTimers();
                                    sendHeartbeat(true);
                                }}
                                className="btn btn-signal flex-1"
                                autoFocus
                            >
                                Stay signed in
                            </button>
                            <button
                                type="button"
                                onClick={handleLogout}
                                className="btn flex-1"
                            >
                                Sign out
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Logout button (fixed) */}
            <button
                type="button"
                onClick={handleLogout}
                className="fixed bottom-4 right-4 z-50 label rounded-full border border-rule bg-surface px-3 py-2 text-ink-soft shadow-md hover:border-ink hover:text-ink transition-colors"
                aria-label="Sign out of analytics"
            >
                Sign out
            </button>
        </>
    );
}
