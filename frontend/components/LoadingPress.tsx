"use client";

import { useEffect, useState } from "react";

const MESSAGES = [
  "Inking the press rollers...",
  "Compositing the type...",
  "Fetching the wires...",
  "Pulling the first proof...",
  "Almost ready to roll..."
];

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
        <img
          className="loading-press"
          src="/illustrations/printing-press.gif"
          alt=""
          aria-hidden="true"
        />
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