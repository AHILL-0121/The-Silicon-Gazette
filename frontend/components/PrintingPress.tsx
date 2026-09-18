"use client";

import { useEffect, useState } from "react";

const STEPS = [
  "Searching the wire for today's news",
  "Drafting the lead story",
  "Setting type for each section",
  "Checking every link against its source",
  "Inking the repo beat",
  "Folding the paper"
];

/**
 * Loading state while an edition is generated (about a minute). A small
 * inline SVG press (a few KB) with CSS-animated rollers and a sheet feeding
 * through; it replaces the 73 MB GIF.
 */
export function PrintingPress() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setStep((value) => Math.min(value + 1, STEPS.length - 1)), 9000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center py-16 text-center">
      <svg viewBox="0 0 240 150" className="w-full max-w-xs text-ink" aria-hidden="true">
        <style>{`
          .sg-roller { transform-box: fill-box; transform-origin: center; animation: sg-spin 1.4s linear infinite; }
          .sg-roller.rev { animation-direction: reverse; }
          .sg-sheet { animation: sg-feed 2.8s cubic-bezier(.5,0,.5,1) infinite; }
          .sg-line { animation: sg-ink 2.8s ease-in-out infinite; transform-box: fill-box; transform-origin: left; }
          .sg-piston { animation: sg-press 1.4s ease-in-out infinite; }
          @keyframes sg-spin { to { transform: rotate(360deg); } }
          @keyframes sg-feed { 0% { transform: translateX(-70px); opacity: 0 } 15% { opacity: 1 } 85% { opacity: 1 } 100% { transform: translateX(95px); opacity: 0 } }
          @keyframes sg-ink { 0%, 35% { transform: scaleX(0) } 60%, 100% { transform: scaleX(1) } }
          @keyframes sg-press { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(6px) } }
          @media (prefers-reduced-motion: reduce) { .sg-roller, .sg-sheet, .sg-line, .sg-piston { animation: none } }
        `}</style>
        {/* Frame */}
        <path d="M30 130V52a8 8 0 0 1 8-8h164a8 8 0 0 1 8 8v78" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M18 130h204" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <g className="sg-piston">
          <rect x="96" y="20" width="48" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="3" />
          <path d="M120 36v14" stroke="currentColor" strokeWidth="3" />
        </g>
        {/* Rollers */}
        {[70, 120, 170].map((cx, index) => (
          <g key={cx} className={`sg-roller${index % 2 ? " rev" : ""}`}>
            <circle cx={cx} cy="72" r="15" fill="none" stroke="currentColor" strokeWidth="3" />
            <path d={`M${cx - 15} 72h30M${cx} 57v30`} stroke="currentColor" strokeWidth="2" opacity="0.5" />
          </g>
        ))}
        {/* Sheet feeding through */}
        <g className="sg-sheet">
          <rect x="80" y="96" width="80" height="26" rx="2" fill="rgb(var(--surface))" stroke="currentColor" strokeWidth="2" />
          <rect className="sg-line" x="88" y="103" width="44" height="3" fill="rgb(var(--signal))" />
          <rect className="sg-line" x="88" y="110" width="62" height="2" fill="currentColor" style={{ animationDelay: "0.15s" }} />
          <rect className="sg-line" x="88" y="115" width="52" height="2" fill="currentColor" style={{ animationDelay: "0.3s" }} />
        </g>
      </svg>

      <p className="label mt-8">Stop the presses · edition in progress</p>
      <p key={step} className="mt-3 animate-fade-up font-display text-3xl leading-tight sm:text-4xl">
        {STEPS[step]}…
      </p>
      <p className="mt-3 max-w-md text-sm text-muted">
        Today&apos;s paper is being written from live sources. This usually takes a minute or two; the page will open
        by itself.
      </p>
      <ol className="mt-8 flex gap-1.5" aria-hidden="true">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={`h-1 w-8 rounded-full transition-colors duration-700 ${index <= step ? "bg-signal" : "bg-rule"}`}
          />
        ))}
      </ol>
    </div>
  );
}
