import type { Metadata } from "next";

import { SITE_NAME } from "./site";

/**
 * A page's `openGraph` object replaces the layout's instead of merging with
 * it, so every page spreads these in to keep og:site_name and og:locale.
 */
export const OPEN_GRAPH_DEFAULTS = {
  siteName: SITE_NAME,
  locale: "en_US"
} satisfies Metadata["openGraph"];

/** Twitter/X card tags that mirror a page's Open Graph title, description and image. */
export function twitterCard(title: string, description: string, image: string): Metadata["twitter"] {
  return { card: "summary_large_image", title, description, images: [image] };
}
