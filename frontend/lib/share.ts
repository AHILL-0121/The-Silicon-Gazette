// ---------------------------------------------------------------------------
// Share menu targets. Every link carries utm_source=<id>&utm_medium=share, so
// visits from it are counted as reader shares from that platform (the ids are
// tags in lib/analytics/sources.ts).
// ---------------------------------------------------------------------------

export type ShareTargetId =
    | "whatsapp"
    | "x"
    | "linkedin"
    | "facebook"
    | "reddit"
    | "telegram"
    | "bluesky"
    | "threads"
    | "hackernews"
    | "email";

export type ShareMethod = ShareTargetId | "copy" | "native";

export type SharePlacement = "story" | "edition" | "footer";

export interface ShareContent {
    title: string;
    text?: string;
}

interface ShareTarget {
    id: ShareTargetId;
    label: string;
    /** `url` is already tagged for this target. */
    href: (url: string, content: ShareContent) => string;
}

const enc = encodeURIComponent;

export const SHARE_TARGETS: ShareTarget[] = [
    { id: "whatsapp", label: "WhatsApp", href: (url, c) => `https://wa.me/?text=${enc(`${c.title} ${url}`)}` },
    { id: "x", label: "X", href: (url, c) => `https://x.com/intent/post?text=${enc(c.title)}&url=${enc(url)}` },
    { id: "linkedin", label: "LinkedIn", href: (url) => `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}` },
    { id: "facebook", label: "Facebook", href: (url) => `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}` },
    { id: "reddit", label: "Reddit", href: (url, c) => `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(c.title)}` },
    { id: "telegram", label: "Telegram", href: (url, c) => `https://t.me/share/url?url=${enc(url)}&text=${enc(c.title)}` },
    { id: "bluesky", label: "Bluesky", href: (url, c) => `https://bsky.app/intent/compose?text=${enc(`${c.title} ${url}`)}` },
    { id: "threads", label: "Threads", href: (url, c) => `https://www.threads.net/intent/post?text=${enc(`${c.title} ${url}`)}` },
    { id: "hackernews", label: "Hacker News", href: (url, c) => `https://news.ycombinator.com/submitlink?u=${enc(url)}&t=${enc(c.title)}` },
    {
        id: "email",
        label: "Email",
        href: (url, c) => `mailto:?subject=${enc(c.title)}&body=${enc(c.text ? `${c.text}\n\n${url}` : url)}`
    }
];

/** `url` (absolute) tagged as a reader share via `method`. */
export function taggedShareUrl(url: string, method: ShareMethod): string {
    const tagged = new URL(url);
    tagged.hash = "";
    tagged.searchParams.set("utm_source", method);
    tagged.searchParams.set("utm_medium", "share");
    return tagged.toString();
}
