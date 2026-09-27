import type { Metadata } from "next";

import { SITE_NAME, SOCIAL_IMAGE } from "./site";

/**
 * A page's `openGraph` object replaces the layout's instead of merging with
 * it, so every page spreads these in to keep og:site_name, og:locale and the
 * social card.
 */
export const OPEN_GRAPH_DEFAULTS = {
  siteName: SITE_NAME,
  locale: "en_US",
  images: [SOCIAL_IMAGE]
} satisfies Metadata["openGraph"];

/** Twitter/X card tags that mirror a page's Open Graph title, description and image. */
export function twitterCard(title: string, description: string): Metadata["twitter"] {
  return { card: "summary_large_image", title, description, images: [SOCIAL_IMAGE.url] };
}
