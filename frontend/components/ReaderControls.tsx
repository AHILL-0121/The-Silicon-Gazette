"use client";

import { useEffect, useState } from "react";

import { track } from "@/lib/analytics/client";

const SIZES = [1.0625, 1.1875, 1.3125, 1.4375];
const LABELS = ["Small", "Regular", "Large", "Extra large"];
const STORAGE_KEY = "sg-reader-size";

/** Text-size control for the story reader. The choice is remembered on this device. */
export function ReaderControls({ targetId }: { targetId: string }) {
  const [step, setStep] = useState(1);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved = raw === null ? NaN : Number(raw);
      if (Number.isInteger(saved) && saved >= 0 && saved < SIZES.length) setStep(saved);
    } catch {
      // Storage unavailable: keep the default size.
    }
  }, []);

  useEffect(() => {
    document.getElementById(targetId)?.style.setProperty("--reader-size", `${SIZES[step]}rem`);
    try {
      localStorage.setItem(STORAGE_KEY, String(step));
    } catch {
      // Ignore: the size still applies for this visit.
    }
  }, [step, targetId]);

  return (
    <div role="group" aria-label="Text size" className="inline-flex items-center rounded-full border border-rule">
      <button
        type="button"
        onClick={() => {
          const next = Math.max(0, step - 1);
          setStep(next);
          track("reader_control", { size: next });
        }}
        disabled={step === 0}
        aria-label="Smaller text"
        className="h-9 w-10 rounded-l-full font-serif text-sm text-ink-soft hover:text-ink disabled:opacity-35"
      >
        A−
      </button>
      <span className="label w-20 border-x border-rule py-2.5 text-center" aria-live="polite">
        {LABELS[step]}
      </span>
      <button
        type="button"
        onClick={() => {
          const next = Math.min(SIZES.length - 1, step + 1);
          setStep(next);
          track("reader_control", { size: next });
        }}
        disabled={step === SIZES.length - 1}
        aria-label="Larger text"
        className="h-9 w-10 rounded-r-full font-serif text-lg text-ink-soft hover:text-ink disabled:opacity-35"
      >
        A+
      </button>
    </div>
  );
}
