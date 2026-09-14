"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

interface StickyMastheadProps {
    date: string;
    issueNumber: number;
}

export function StickyMasthead({ date, issueNumber }: StickyMastheadProps) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        function onScroll() {
            if (window.scrollY > 300) {
                if (!el!.classList.contains("is-visible")) {
                    el!.classList.add("is-visible");
                }
            } else {
                el!.classList.remove("is-visible");
            }
        }

        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    return (
        <div className="sticky-masthead" ref={ref} aria-hidden="true">
            <Link href="/" className="sticky-masthead__title">The Silicon Gazette</Link>
            <span className="sticky-masthead__meta">
                {date} · Issue {issueNumber}
            </span>
            <div className="sticky-masthead__actions">
                <Link href="/archive" className="sticky-masthead__link">Archive</Link>
            </div>
        </div>
    );
}
