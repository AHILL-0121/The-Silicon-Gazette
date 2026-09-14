"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Link from "next/link";

gsap.registerPlugin(ScrollTrigger);

interface MastheadProps {
  date: string;
  issueNumber: number;
}

export function Masthead({ date, issueNumber }: MastheadProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const rulesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const titleEl = titleRef.current;
    const rulesEl = rulesRef.current;
    if (!titleEl) return;

    // Split title into individual letters and animate them rising in
    const text = titleEl.textContent ?? "";
    titleEl.textContent = "";
    titleEl.style.overflow = "hidden";

    const words = text.split(" ");
    words.forEach((word, wi) => {
      const wordSpan = document.createElement("span");
      wordSpan.style.display = "inline-block";
      wordSpan.style.overflow = "hidden";

      [...word].forEach((char) => {
        const charSpan = document.createElement("span");
        charSpan.textContent = char;
        charSpan.style.display = "inline-block";
        charSpan.style.transform = "translateY(110%)";
        charSpan.style.opacity = "0";
        wordSpan.appendChild(charSpan);
      });

      titleEl.appendChild(wordSpan);
      if (wi < words.length - 1) {
        const space = document.createTextNode(" ");
        titleEl.appendChild(space);
      }
    });

    const chars = titleEl.querySelectorAll("span > span");
    gsap.to(chars, {
      translateY: "0%",
      opacity: 1,
      duration: 0.7,
      stagger: 0.05,
      ease: "power3.out",
      delay: 0.15,
    });

    // Draw the rules in from left
    if (rulesEl) {
      const rule1 = rulesEl.querySelector(".rule-heavy");
      const rule2 = rulesEl.querySelector(".rule-light");
      gsap.fromTo(
        [rule1, rule2],
        { scaleX: 0, transformOrigin: "left" },
        { scaleX: 1, duration: 0.9, stagger: 0.1, ease: "power2.inOut", delay: 0.4 }
      );
    }
  }, []);

  return (
    <header className="masthead" role="banner">
      <div className="masthead-top">
        <span className="est-line">Est. 2026 — {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
        <nav className="masthead-nav" aria-label="Site navigation">
          <Link href="/archive">Archive</Link>
        </nav>
      </div>

      <div className="masthead-title-wrap">
        <Link href="/" className="title-link" style={{ textDecoration: 'none', display: 'inline-block' }}>
          <h1 className="title" ref={titleRef} aria-label="The Silicon Gazette">
            The Silicon Gazette
          </h1>
        </Link>
      </div>

      <div ref={rulesRef}>
        <div className="rule-heavy" />
        <p className="tagline">All the code that&apos;s fit to print</p>
        <div className="rule-light" />
      </div>

      <div className="meta-bar">
        <span className="meta-item">Issue No. {issueNumber}</span>
        <span className="meta-item">Vol. I</span>
        <span className="meta-item">Daily Edition</span>
        <span className="meta-item">{date}</span>
      </div>
    </header>
  );
}