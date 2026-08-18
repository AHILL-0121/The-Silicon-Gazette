"use client";

interface ErrorPressProps {
  title: string;
  body: string;
  detail?: string;
  showRetry?: boolean;
}

export function ErrorPress({ title, body, detail, showRetry = true }: ErrorPressProps) {
  function handleRetry() {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }

  return (
    <div className="err-wrap" role="alert">
      <h2 className="err-hed">{title}</h2>
      <p className="err-body">{body}</p>
      {detail ? <pre className="err-detail">{detail}</pre> : null}
      {showRetry ? (
        <button className="refresh-btn" onClick={handleRetry} type="button">
          Restart the Press
        </button>
      ) : null}
    </div>
  );
}