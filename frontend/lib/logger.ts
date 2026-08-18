export function logServerError(context: string, error: unknown): void {
  if (error instanceof Error) {
    console.error(`[${context}]`, error.message, error.stack);
    return;
  }
  console.error(`[${context}]`, error);
}