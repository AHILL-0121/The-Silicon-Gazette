"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

interface HeadlineTickerProps {
    headlines: string[];
}

export function HeadlineTicker({ headlines }: HeadlineTickerProps) {
    const trackRef = useRef<HTMLDivElement>(null);
    const tweenRef = useRef<gsap.core.Tween | null>(null);
    const reduced = useRef(false);

    useEffect(() => {
        reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduced.current || !trackRef.current) return;

        const track = trackRef.current;
        // Duplicate the track content for seamless loop
        const clone = track.cloneNode(true) as HTMLDivElement;
        clone.setAttribute("aria-hidden", "true");
        track.parentElement?.appendChild(clone);

        const totalWidth = track.scrollWidth;

        tweenRef.current = gsap.to([track, clone], {
            x: `-=${totalWidth}`,
            duration: headlines.length * 6,
            ease: "none",
            repeat: -1,
            modifiers: {
                x: gsap.utils.unitize((x) => {
                    return parseFloat(x) % totalWidth;
                }),
            },
        });

        return () => {
            tweenRef.current?.kill();
            clone.remove();
        };
    }, [headlines]);

    function pauseTicker() {
        tweenRef.current?.pause();
    }

    function resumeTicker() {
        tweenRef.current?.resume();
    }

    if (headlines.length === 0) return null;

    return (
        <div
            className="ticker-wrap"
            onMouseEnter={pauseTicker}
            onMouseLeave={resumeTicker}
            onFocus={pauseTicker}
            onBlur={resumeTicker}
            aria-label="Breaking headlines ticker"
        >
            <span className="ticker-label" aria-hidden="true">WIRE</span>
            <div className="ticker-viewport" aria-live="off">
                <div className="ticker-track" ref={trackRef}>
                    {headlines.map((headline, idx) => (
                        <span key={idx} className="ticker-item" aria-label={headline}>
                            {headline}
                            <span className="ticker-dot" aria-hidden="true">◆</span>
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}
