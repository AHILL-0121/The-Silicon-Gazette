"use client";

import { useEffect, useState } from "react";

const MESSAGES = [
  "Inking the press rollers...",
  "Compositing the type...",
  "Fetching the wires...",
  "Pulling the first proof...",
  "Almost ready to roll..."
];

/** Lightweight animated SVG printing press — replaces the deleted 73 MB GIF (PERF-01) */
function PrintingPressSVG() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 240 180"
      width="240"
      height="180"
      aria-hidden="true"
      className="loading-press-svg"
    >
      {/* Press body */}
      <rect x="40" y="60" width="160" height="90" rx="6" fill="#2c200f" />
      <rect x="50" y="70" width="140" height="70" rx="4" fill="#f7f3e8" />

      {/* Ink roller — animates left↔right */}
      <rect x="55" y="66" width="12" height="16" rx="3" fill="#9b1a0a">
        <animate attributeName="x" from="55" to="173" dur="1.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" keyTimes="0;0.5;1" />
      </rect>

      {/* Paper lines (text being printed) */}
      <g opacity="0.55">
        <rect x="62" y="82" width="116" height="4" rx="2" fill="#1a1009">
          <animate attributeName="opacity" values="0;1;1;0" dur="1.6s" repeatCount="indefinite" keyTimes="0;0.3;0.8;1" />
        </rect>
        <rect x="62" y="92" width="96" height="4" rx="2" fill="#1a1009">
          <animate attributeName="opacity" values="0;0;1;0" dur="1.6s" repeatCount="indefinite" keyTimes="0;0.4;0.8;1" />
        </rect>
        <rect x="62" y="102" width="108" height="4" rx="2" fill="#1a1009">
          <animate attributeName="opacity" values="0;0;0;1" dur="1.6s" repeatCount="indefinite" keyTimes="0;0.5;0.7;1" begin="0.4s" />
        </rect>
        <rect x="62" y="112" width="76" height="4" rx="2" fill="#1a1009">
          <animate attributeName="opacity" values="0;0;1;1" dur="1.6s" repeatCount="indefinite" keyTimes="0;0.55;0.75;1" begin="0.6s" />
        </rect>
        <rect x="62" y="122" width="88" height="4" rx="2" fill="#1a1009">
          <animate attributeName="opacity" values="0;0;0;1" dur="1.6s" repeatCount="indefinite" keyTimes="0;0.6;0.8;1" begin="0.8s" />
        </rect>
      </g>

      {/* Press frame legs */}
      <rect x="52" y="148" width="14" height="22" rx="3" fill="#2c200f" />
      <rect x="174" y="148" width="14" height="22" rx="3" fill="#2c200f" />

      {/* Masthead plate */}
      <rect x="70" y="36" width="100" height="24" rx="3" fill="#9b1a0a" />
      <text x="120" y="53" textAnchor="middle" fill="#f7f3e8" fontFamily="serif" fontSize="11" fontWeight="bold" letterSpacing="1">
        THE PRESS
      </text>

      {/* Paper feed — animated strip sliding down */}
      <rect x="100" y="148" width="40" height="20" rx="2" fill="#f7f3e8" stroke="#9b8a6a" strokeWidth="1">
        <animate attributeName="y" from="148" to="162" dur="1.6s" repeatCount="indefinite" />
        <animate attributeName="opacity" from="1" to="0.2" dur="1.6s" repeatCount="indefinite" />
      </rect>
    </svg>
  );
}

export function LoadingPress() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((value) => (value + 1) % MESSAGES.length);
    }, 2200);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="loading-wrap" role="status" aria-live="polite">
      <div className="loading-press-frame">
        <PrintingPressSVG />
      </div>
      <p className="loading-msg">{MESSAGES[index]}</p>
      <div className="dots" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}