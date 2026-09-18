import { formatDisplayDate } from "./date";
import { CATEGORY_LABELS, excerpt, type EditionView, type StoryView } from "./edition-view";
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME, siteUrl } from "./site";
import type { EditionRecord } from "./types";

/** schema.org structured data for search engines (JSON-LD). */

const orgId = () => `${siteUrl()}/#organization`;
const websiteId = () => `${siteUrl()}/#website`;

function publisherRef() {
  return { "@id": orgId() };
}

/** Site-wide: the publication and the website. */
export function siteGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "NewsMediaOrganization",
        "@id": orgId(),
        name: SITE_NAME,
        url: absoluteUrl("/"),
        logo: { "@type": "ImageObject", url: absoluteUrl("/apple-icon.png"), width: 180, height: 180 }
      },
      {
        "@type": "WebSite",
        "@id": websiteId(),
        name: SITE_NAME,
        url: absoluteUrl("/"),
        description: SITE_DESCRIPTION,
        inLanguage: "en",
        publisher: publisherRef()
      }
    ]
  };
}

function breadcrumbs(items: Array<{ name: string; path: string }>) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path)
    }))
  };
}

/** Google shows at most 110 characters of a NewsArticle headline. */
function headline(text: string) {
  return text.length <= 110 ? text : `${text.slice(0, 109).trimEnd()}…`;
}

/** An edition: a dated collection of stories, led by the lead story printed on it. */
export function editionGraph(edition: EditionRecord, view: EditionView) {
  const path = `/gazette/${edition.date}`;
  const displayDate = formatDisplayDate(edition.date);
  const image = absoluteUrl(`${path}/opengraph-image`);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${absoluteUrl(path)}#page`,
        url: absoluteUrl(path),
        name: `${SITE_NAME}, ${displayDate}`,
        description: view.lead.deck,
        datePublished: edition.generated_at,
        inLanguage: "en",
        isPartOf: { "@id": websiteId() },
        primaryImageOfPage: image,
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: view.stories.length,
          itemListElement: view.stories.map((story, index) => ({
            "@type": "ListItem",
            position: index + 1,
            url: absoluteUrl(story.href),
            name: story.headline
          }))
        }
      },
      {
        "@type": "NewsArticle",
        "@id": `${absoluteUrl(path)}#lead`,
        headline: headline(view.lead.title),
        description: view.lead.deck,
        articleSection: CATEGORY_LABELS[view.lead.category],
        datePublished: edition.generated_at,
        dateModified: edition.generated_at,
        image: [image],
        url: `${absoluteUrl(path)}#front`,
        mainEntityOfPage: `${absoluteUrl(path)}#page`,
        author: publisherRef(),
        publisher: publisherRef(),
        inLanguage: "en",
        isAccessibleForFree: true,
        ...(view.lead.sourceUrl ? { isBasedOn: view.lead.sourceUrl } : {})
      },
      breadcrumbs([
        { name: SITE_NAME, path: "/" },
        { name: "Archive", path: "/archive" },
        { name: displayDate, path }
      ])
    ]
  };
}

/** A story page. The author is the publication: stories are written by a language model. */
export function storyGraph(edition: EditionRecord, story: StoryView, sectionLabel: string) {
  const url = absoluteUrl(story.href);
  const editionPath = `/gazette/${edition.date}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "NewsArticle",
        "@id": `${url}#article`,
        headline: headline(story.headline),
        description: excerpt(story.paragraphs[0] ?? story.summary, 160),
        articleSection: sectionLabel,
        datePublished: edition.generated_at,
        dateModified: edition.generated_at,
        image: [absoluteUrl(`${story.href}/opengraph-image`)],
        url,
        mainEntityOfPage: { "@type": "WebPage", "@id": url },
        wordCount: story.summary.split(/\s+/).filter(Boolean).length,
        timeRequired: `PT${story.readMinutes}M`,
        author: publisherRef(),
        publisher: publisherRef(),
        isPartOf: { "@id": `${absoluteUrl(editionPath)}#page` },
        inLanguage: "en",
        isAccessibleForFree: true,
        ...(story.sourceUrl ? { isBasedOn: story.sourceUrl, citation: story.sourceUrl } : {})
      },
      breadcrumbs([
        { name: SITE_NAME, path: "/" },
        { name: formatDisplayDate(edition.date), path: editionPath },
        { name: sectionLabel, path: `${editionPath}#${story.sectionId}` },
        { name: story.headline, path: story.href }
      ])
    ]
  };
}

/** The archive listing. */
export function archiveGraph(totalEditions: number) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${absoluteUrl("/archive")}#page`,
        url: absoluteUrl("/archive"),
        name: `Archive · ${SITE_NAME}`,
        description: `Every edition of ${SITE_NAME}: ${totalEditions} and counting.`,
        isPartOf: { "@id": websiteId() },
        inLanguage: "en"
      },
      breadcrumbs([
        { name: SITE_NAME, path: "/" },
        { name: "Archive", path: "/archive" }
      ])
    ]
  };
}
