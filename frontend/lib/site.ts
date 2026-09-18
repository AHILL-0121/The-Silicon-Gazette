export const SITE_NAME = "The Silicon Gazette";
export const SITE_TAGLINE = "All the code that's fit to print.";
export const SITE_DESCRIPTION = "A daily broadsheet of AI, tech and open-source news. All the code that's fit to print.";

/**
 * Absolute origin used for canonical URLs, social images, the sitemap and
 * structured data. `NEXT_PUBLIC_BASE_URL` wins; on Vercel the production
 * domain (or the deployment URL for previews) is used when it's unset, so
 * production never advertises localhost.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function absoluteUrl(path: string): string {
  return new URL(path, `${siteUrl()}/`).toString();
}
