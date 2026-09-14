"use client";

import { useEffect, useState } from "react";
import gsap from "gsap";

export function BackToTop() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        function onScroll() {
            setVisible(window.scrollY > 600);
        }
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    function handleClick() {
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduced ? "instant" : "smooth" });
    }

    return (
        <button
            className={`back-to-top${visible ? " is-visible" : ""}`}
            onClick={handleClick}
            type="button"
            aria-label="Back to top"
            aria-hidden={!visible}
            tabIndex={visible ? 0 : -1}
        >
            ↑
        </button>
    );
}
