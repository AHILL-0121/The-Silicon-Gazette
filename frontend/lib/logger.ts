type Level = "info" | "warn" | "error";

/**
 * One JSON object per line, so Vercel's log search (or any drain such as
 * Axiom, Better Stack or Datadog) can filter on `event`, `level` and fields.
 */
export function logEvent(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      error: error.message,
      errorName: error.name,
      stack: error.stack?.split("\n").slice(0, 8).join("\n"),
      ...(error.cause ? { cause: error.cause instanceof Error ? error.cause.message : String(error.cause) } : {})
    };
  }
  return { error: String(error) };
}

export function logServerError(context: string, error: unknown, fields: Record<string, unknown> = {}): void {
  logEvent("error", context, { ...fields, ...errorFields(error) });
}
