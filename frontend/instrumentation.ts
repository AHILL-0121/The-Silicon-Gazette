export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runStartupChecks } = await import("@/lib/startup-checks");
  await runStartupChecks();
}
