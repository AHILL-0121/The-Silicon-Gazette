// ---------------------------------------------------------------------------
// Page type + edition_date + story_slug from pathname (D10)
// ---------------------------------------------------------------------------
export type PageType = "home" | "edition" | "story" | "archive" | "latest" | "404" | "other";

export interface PathInfo {
    pageType: PageType;
    editionDate: string | null;
    storySlug: string | null;
}

const EDITION_RE = /^\/gazette\/(\d{4}-\d{2}-\d{2})(?:\/?$)/;
const STORY_RE = /^\/gazette\/(\d{4}-\d{2}-\d{2})\/story\/(.+)$/;

export function pageTypeFromPath(path: string): PathInfo {
    if (path === "/" || path === "") return { pageType: "home", editionDate: null, storySlug: null };
    if (path === "/archive") return { pageType: "archive", editionDate: null, storySlug: null };
    if (path === "/latest") return { pageType: "latest", editionDate: null, storySlug: null };

    const storyMatch = STORY_RE.exec(path);
    if (storyMatch) {
        return { pageType: "story", editionDate: storyMatch[1], storySlug: storyMatch[2] };
    }

    const editionMatch = EDITION_RE.exec(path);
    if (editionMatch) {
        return { pageType: "edition", editionDate: editionMatch[1], storySlug: null };
    }

    return { pageType: "other", editionDate: null, storySlug: null };
}
