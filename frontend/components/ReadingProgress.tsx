"use client";

import { useEffect, useRef } from "react";

/** Ink-red reading progress bar fixed to the top of the viewport */
export function ReadingProgress() {
    const barRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function update() {
            const scrollTop = window.scrollY;
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;
            const pct = docHeight > 0 ? Math.min(100, (scrollTop / docHeight) * 100) : 0;
            if (barRef.current) {
                barRef.current.style.transform = `scaleX(${pct / 100})`;
            }
        }

        window.addEventListener("scroll", update, { passive: true });
        update();
        return () => window.removeEventListener("scroll", update);
    }, []);

    return (
        <div className="reading-progress-track" aria-hidden="true">
            <div className="reading-progress-bar" ref={barRef} />
        </div>
    );
}
