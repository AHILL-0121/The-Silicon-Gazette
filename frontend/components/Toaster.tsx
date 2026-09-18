"use client";

import { useEffect, useState } from "react";

const EVENT = "sg:toast";

/** Shows a short status message in the shared live region. */
export function toast(message: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

export function Toaster() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onToast = (event: Event) => {
      setMessage((event as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 3200);
    };
    window.addEventListener(EVENT, onToast);
    return () => {
      window.removeEventListener(EVENT, onToast);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[90] flex justify-center px-4"
    >
      {message && (
        <p className="animate-fade-up rounded-full bg-ink px-4 py-2.5 text-sm text-paper shadow-lg">{message}</p>
      )}
    </div>
  );
}
