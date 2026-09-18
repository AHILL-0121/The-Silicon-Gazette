export type Category =
  | "AI"
  | "TECH"
  | "OPEN SOURCE"
  | "STARTUP"
  | "HARDWARE"
  | "SECURITY";

export interface Headline {
  title: string;
  deck: string;
  body: string;
  category: Category;
  source: string;
  url?: string;
}

export interface Story {
  headline: string;
  summary: string;
  category: Category;
  source: string;
  url?: string;
}

export interface Repo {
  name: string;
  description: string;
  stars: string;
  language: string;
}

export interface GazetteEdition {
  headline: Headline;
  stories: Story[];
  repos: Repo[];
  market_brief: string;
}

export interface EditionRecord {
  id: number;
  date: string;
  issue_num: number;
  content: GazetteEdition;
  generated_at: string;
  model: string;
  latency_ms: number | null;
}

export interface EditionSummary {
  date: string;
  issue_num: number;
  generated_at: string;
  title: string;
  deck: string;
  category: Category;
}

export interface ArchiveQuery {
  /** 1-based page number. */
  page: number;
  pageSize: number;
  /** Free text matched against the lead title, deck, story headlines and the date. */
  q?: string;
  category?: Category;
}

export interface ArchivePage {
  items: EditionSummary[];
  /** Editions matching q and category. */
  total: number;
  /** Editions per lead category, for editions matching q (ignoring the category filter). */
  categories: Array<{ category: Category; count: number }>;
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  published_date?: string;
  score: number;
}

export interface SearchTopicBlock {
  topic: "AI" | "TECH" | "OPEN SOURCE";
  query: string;
  results: SearchResult[];
}

export interface SearchContext {
  blocks: SearchTopicBlock[];
  serialized: string;
}