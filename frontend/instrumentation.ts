import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runStartupChecks } = await import("@/lib/startup-checks");
  // Fire and forget: the checks make four network calls and only log. Awaiting
  // them held back "Ready" in dev and every serverless cold start.
  void runStartupChecks().catch((error) => console.warn("[startup] checks failed:", error));
}

/**
 * Every uncaught server error (pages, route handlers, server actions) is
 * logged as one structured line with its digest (the "Reference" readers see
 * on the error page) and sent as an alert.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logServerError } = await import("@/lib/logger");
  const { sendAlert } = await import("@/lib/alerts");
  const digest = (error as { digest?: string }).digest;
  const fields = {
    digest,
    method: request.method,
    path: request.path,
    route: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource
  };
  logServerError("request.error", error, fields);
  await sendAlert(`request-error:${context.routePath}`, `Server error on ${context.routePath}`, {
    ...fields,
    error: error instanceof Error ? error.message.slice(0, 300) : String(error)
  });
};
