import type { CSSProperties } from "react";

/** A placeholder bar for loading states; hidden from assistive tech. */
export function Bar({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden="true" className={`animate-blink rounded-full bg-rule ${className}`} style={style} />;
}

/** Page-level wrapper: announces loading once, with a placeholder header bar. */
export function LoadingShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="min-h-screen">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="h-14 border-b border-rule" />
      {children}
    </div>
  );
}
