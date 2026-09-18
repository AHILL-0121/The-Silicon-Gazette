import type { CSSProperties } from "react";

interface MastheadProps {
  id?: string;
  issueNumber: number;
  displayDate: string;
  storyCount: number;
  readMinutes: number;
}

const WORDS: Array<{ text: string; accent?: boolean }> = [
  { text: "The" },
  { text: "Silicon", accent: true },
  { text: "Gazette" }
];

/** The broadsheet nameplate. Letters rise in one by one and the rules draw across. */
export function Masthead({ id = "masthead", issueNumber, displayDate, storyCount, readMinutes }: MastheadProps) {
  let letterIndex = 0;
  return (
    <section id={id} aria-labelledby={`${id}-title`} data-parallax-root className="page-x pt-6 sm:pt-10">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pb-3">
        <p className="label">Vol. I · No. {issueNumber}</p>
        <p className="label order-last w-full text-center sm:order-none sm:w-auto">{displayDate}</p>
        <p className="label">
          {storyCount} stories · {readMinutes} min read
        </p>
      </div>
      <div className="draw-rule h-px bg-ink" />

      <h1
        id={`${id}-title`}
        aria-label="The Silicon Gazette"
        data-anim="parallax"
        data-speed="0.45"
        data-fade="0.2"
        className="py-3 text-center font-display leading-[0.86] tracking-[-0.02em] text-[clamp(3.1rem,13.2vw,11.5rem)] sm:py-5"
      >
        {WORDS.map((word, wordIndex) => (
          <span key={word.text} aria-hidden="true" className={word.accent ? "italic text-signal" : undefined}>
            <span className="rise">
              {word.text.split("").map((letter) => (
                <span key={letterIndex} style={{ "--i": letterIndex++ } as CSSProperties}>
                  {letter}
                </span>
              ))}
            </span>
            {wordIndex < WORDS.length - 1 ? " " : ""}
          </span>
        ))}
      </h1>

      <div className="draw-rule rule-double" style={{ "--base": "250ms" } as CSSProperties} />
      <div className="flex flex-col items-center justify-between gap-2 py-3 sm:flex-row">
        <p className="font-serif text-lg italic text-ink-soft">All the code that&apos;s fit to print.</p>
        <p className="label flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 animate-blink rounded-full bg-signal" aria-hidden="true" />
          Set by machines · Checked against the wire
        </p>
      </div>
    </section>
  );
}
