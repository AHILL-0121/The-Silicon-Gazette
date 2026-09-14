"use client";

interface ErrorPressProps {
  title: string;
  body: string;
  /** digest: the Next.js error digest, safe to expose. Never pass raw error.message in production. */
  digest?: string;
  showRetry?: boolean;
  reset?: () => void;
}

export function ErrorPress({ title, body, digest, showRetry = true, reset }: ErrorPressProps) {
  function handleRetry() {
    if (reset) {
      reset();
    } else if (typeof window !== "undefined") {
      window.location.reload();
    }
  }

  return (
    <div className="err-wrap" role="alert">
      <h2 className="err-hed">{title}</h2>
      <p className="err-body">{body}</p>
      {digest && process.env.NODE_ENV !== "production" ? (
        <pre className="err-detail">digest: {digest}</pre>
      ) : null}
      {showRetry ? (
        <button className="refresh-btn" onClick={handleRetry} type="button">
          Restart the Press
        </button>
      ) : null}
    </div>
  );
}