import { neon, neonConfig } from "@neondatabase/serverless";
import { and, asc, count, desc, eq, gt, lt, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import { logEvent } from "./logger";
import { editions, searchContexts } from "./schema";
import type {
  ArchivePage,
  ArchiveQuery,
  Category,
  EditionRecord,
  EditionSummary,
  GazetteEdition,
  SearchTopicBlock
} from "./types";

interface SaveEditionInput {
  date: string;
  issue_num: number;
  content: GazetteEdition;
  latency_ms: number;
  model: string;
}

const memoryStoreHolder = globalThis as typeof globalThis & {
  __siliconGazetteMemory?: Map<string, EditionRecord>;
  __siliconGazetteCounter?: number;
  __siliconGazetteDbFallbackWarned?: boolean;
};

if (!memoryStoreHolder.__siliconGazetteMemory) {
  memoryStoreHolder.__siliconGazetteMemory = new Map();
  memoryStoreHolder.__siliconGazetteCounter = 1;
}

function memoryRecords(): EditionRecord[] {
  return [...(memoryStoreHolder.__siliconGazetteMemory?.values() ?? [])].sort((a, b) =>
    b.date.localeCompare(a.date)
  );
}

function shouldFallbackToMemory(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("relation \"editions\" does not exist") ||
    message.includes("relation 'editions' does not exist") ||
    message.includes("table \"editions\" does not exist")
  );
}

function warnMemoryFallback(error: unknown): void {
  if (memoryStoreHolder.__siliconGazetteDbFallbackWarned) {
    return;
  }

  memoryStoreHolder.__siliconGazetteDbFallbackWarned = true;
  logEvent("warn", "db.memory_fallback", {
    error: error instanceof Error ? error.message : String(error),
    fix: "Run `npx drizzle-kit push` to create the schema in your Neon database."
  });
}

/**
 * Every Neon HTTP query gets its own timeout, so a stalled connection fails
 * fast (and reaches the error page) instead of hanging until the function's
 * limit. Callers' own abort signals still apply.
 */
const DB_TIMEOUT_MS = Number(process.env.DB_TIMEOUT_MS ?? 10_000);
neonConfig.fetchFunction = (input: RequestInfo | URL, init: RequestInit = {}) => {
  const timeout = AbortSignal.timeout(DB_TIMEOUT_MS);
  return fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
};

function getDb() {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  // No explicit fetch cache option on purpose. In Next 15 such fetches are
  // never cached at runtime ("auto no cache") and, unlike `cache: "no-store"`,
  // don't abort ISR rendering of pages that read the database. Pages cache
  // past editions explicitly with unstable_cache (see edition-service.ts).
  const client = neon(process.env.DATABASE_URL);
  return drizzle(client);
}

/**
 * Named db instance for analytics and other server-only callers.
 * Throws if DATABASE_URL is not set — analytics routes handle the error.
 */
export const db = (() => {
  const client = neon(process.env.DATABASE_URL ?? "");
  return drizzle(client);
})();

async function withMemoryFallback<T>(query: () => Promise<T>, fromMemory: () => T): Promise<T> {
  try {
    return await query();
  } catch (error) {
    if (shouldFallbackToMemory(error)) {
      warnMemoryFallback(error);
      return fromMemory();
    }
    throw error;
  }
}

function toRecord(row: {
  id: number;
  date: string;
  issueNum: number;
  content: GazetteEdition;
  generatedAt: Date | string;
  model: string;
  latencyMs: number | null;
}): EditionRecord {
  return {
    id: row.id,
    date: row.date,
    issue_num: row.issueNum,
    content: row.content,
    generated_at:
      typeof row.generatedAt === "string" ? row.generatedAt : row.generatedAt.toISOString(),
    model: row.model,
    latency_ms: row.latencyMs
  };
}

function toSummary(record: EditionRecord): EditionSummary {
  return {
    date: record.date,
    issue_num: record.issue_num,
    generated_at: record.generated_at,
    title: record.content.headline.title,
    deck: record.content.headline.deck,
    category: record.content.headline.category
  };
}

export async function getEditionByDate(date: string): Promise<EditionRecord | null> {
  const db = getDb();
  const fromMemory = () => memoryStoreHolder.__siliconGazetteMemory?.get(date) ?? null;
  if (!db) {
    return fromMemory();
  }

  return withMemoryFallback(async () => {
    const rows = await db.select().from(editions).where(eq(editions.date, date)).limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }, fromMemory);
}

/**
 * Persists an edition. The first successful write for a date wins: a second,
 * concurrent generation does not overwrite content that readers may already
 * be viewing. The stored record is returned in both cases.
 */
export async function saveEdition(input: SaveEditionInput): Promise<EditionRecord> {
  function saveToMemory(): EditionRecord {
    const existing = memoryStoreHolder.__siliconGazetteMemory?.get(input.date);
    if (existing) {
      return existing;
    }
    const record: EditionRecord = {
      id: memoryStoreHolder.__siliconGazetteCounter as number,
      date: input.date,
      issue_num: input.issue_num,
      content: input.content,
      generated_at: new Date().toISOString(),
      model: input.model,
      latency_ms: input.latency_ms
    };

    memoryStoreHolder.__siliconGazetteCounter = (memoryStoreHolder.__siliconGazetteCounter as number) + 1;
    memoryStoreHolder.__siliconGazetteMemory?.set(input.date, record);
    return record;
  }

  const db = getDb();
  if (!db) {
    return saveToMemory();
  }

  return withMemoryFallback(async () => {
    const inserted = await db
      .insert(editions)
      .values({
        date: input.date,
        issueNum: input.issue_num,
        content: input.content,
        latencyMs: input.latency_ms,
        model: input.model
      })
      .onConflictDoNothing({ target: editions.date })
      .returning();

    if (inserted[0]) {
      return toRecord(inserted[0]);
    }

    const existing = await db.select().from(editions).where(eq(editions.date, input.date)).limit(1);
    if (!existing[0]) {
      throw new Error(`Edition ${input.date} could not be saved or read back.`);
    }
    return toRecord(existing[0]);
  }, saveToMemory);
}

/** Stored search results are only needed while that day's edition is being retried. */
const SEARCH_CONTEXT_KEEP_DAYS = 7;

/** The day's stored Tavily results, or null if none were saved (or there is no database). */
export async function getSearchContext(date: string): Promise<SearchTopicBlock[] | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db
    .select({ blocks: searchContexts.blocks })
    .from(searchContexts)
    .where(eq(searchContexts.date, date))
    .limit(1);
  return rows[0]?.blocks ?? null;
}

/** Stores the day's Tavily results (first write wins) and drops ones older than a week. */
export async function saveSearchContext(date: string, blocks: SearchTopicBlock[]): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.insert(searchContexts).values({ date, blocks }).onConflictDoNothing({ target: searchContexts.date });
  await db
    .delete(searchContexts)
    .where(lt(searchContexts.date, sql`${date}::date - ${SEARCH_CONTEXT_KEEP_DAYS}::int`));
}

const leadTitle = sql<string>`${editions.content}->'headline'->>'title'`;
const leadDeck = sql<string>`${editions.content}->'headline'->>'deck'`;
const leadCategory = sql<string>`${editions.content}->'headline'->>'category'`;

/** Escapes LIKE wildcards so a search for "50%" matches literally. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function searchCondition(q: string | undefined): SQL | undefined {
  const text = q?.trim();
  if (!text) return undefined;
  const pattern = likePattern(text);
  return sql`(
    ${leadTitle} ILIKE ${pattern}
    OR ${leadDeck} ILIKE ${pattern}
    OR jsonb_path_query_array(${editions.content}, '$.stories[*].headline')::text ILIKE ${pattern}
    OR ${editions.date}::text LIKE ${pattern}
  )`;
}

/**
 * One page of the archive, newest first, with search and a lead-category
 * filter applied in the database. Only lead title, deck and category are
 * returned (never story bodies), plus totals for pagination and filter chips.
 */
export async function listEditionSummariesPage(query: ArchiveQuery): Promise<ArchivePage> {
  const offset = (query.page - 1) * query.pageSize;

  const fromMemory = (): ArchivePage => {
    const text = query.q?.trim().toLowerCase();
    const matching = memoryRecords().filter((record) => {
      if (!text) return true;
      const haystack = [
        record.content.headline.title,
        record.content.headline.deck,
        record.date,
        ...record.content.stories.map((story) => story.headline)
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(text);
    });
    const counts = new Map<Category, number>();
    for (const record of matching) {
      const category = record.content.headline.category;
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    const filtered = query.category
      ? matching.filter((record) => record.content.headline.category === query.category)
      : matching;
    return {
      items: filtered.slice(offset, offset + query.pageSize).map(toSummary),
      total: filtered.length,
      categories: [...counts.entries()].map(([category, value]) => ({ category, count: value }))
    };
  };

  const db = getDb();
  if (!db) {
    return fromMemory();
  }

  return withMemoryFallback(async () => {
    const search = searchCondition(query.q);
    const where = and(search, query.category ? sql`${leadCategory} = ${query.category}` : undefined);

    const [rows, [totalRow], categoryRows] = await Promise.all([
      db
        .select({
          date: editions.date,
          issueNum: editions.issueNum,
          generatedAt: editions.generatedAt,
          title: leadTitle,
          deck: leadDeck,
          category: leadCategory
        })
        .from(editions)
        .where(where)
        .orderBy(desc(editions.date))
        .limit(query.pageSize)
        .offset(offset),
      db.select({ total: count() }).from(editions).where(where),
      db
        .select({ category: leadCategory, total: count() })
        .from(editions)
        .where(search)
        .groupBy(leadCategory)
    ]);

    return {
      items: rows.map((row) => ({
        date: row.date,
        issue_num: row.issueNum,
        generated_at: typeof row.generatedAt === "string" ? row.generatedAt : row.generatedAt.toISOString(),
        title: row.title ?? "",
        deck: row.deck ?? "",
        category: (row.category ?? "TECH") as Category
      })),
      total: Number(totalRow?.total ?? 0),
      categories: categoryRows
        .filter((row) => row.category)
        .map((row) => ({ category: row.category as Category, count: Number(row.total) }))
    };
  }, fromMemory);
}

export interface EditionStoryIndex {
  date: string;
  generated_at: string;
  lead: { headline: string; summary: string };
  stories: Array<{ headline: string; summary: string }>;
}

/**
 * Headlines and summaries of every edition, for the sitemap. Duplicate
 * detection needs summaries to decide which story pages exist; repos, sources
 * and other fields are left out. Callers should cache the result.
 */
export async function listEditionStoryIndex(): Promise<EditionStoryIndex[]> {
  const db = getDb();
  const fromMemory = () =>
    memoryRecords().map((record) => ({
      date: record.date,
      generated_at: record.generated_at,
      lead: { headline: record.content.headline.title, summary: record.content.headline.body },
      stories: record.content.stories.map(({ headline, summary }) => ({ headline, summary }))
    }));
  if (!db) {
    return fromMemory();
  }

  return withMemoryFallback(async () => {
    const rows = await db
      .select({
        date: editions.date,
        generatedAt: editions.generatedAt,
        leadHeadline: sql<string>`${editions.content}->'headline'->>'title'`,
        leadSummary: sql<string>`${editions.content}->'headline'->>'body'`,
        stories: sql<Array<{ headline: string; summary: string }> | null>`(
          select jsonb_agg(jsonb_build_object('headline', s->>'headline', 'summary', s->>'summary'))
          from jsonb_array_elements(${editions.content}->'stories') s
        )`
      })
      .from(editions)
      .orderBy(desc(editions.date));

    return rows.map((row) => ({
      date: row.date,
      generated_at: typeof row.generatedAt === "string" ? row.generatedAt : row.generatedAt.toISOString(),
      lead: { headline: row.leadHeadline ?? "", summary: row.leadSummary ?? "" },
      stories: Array.isArray(row.stories) ? row.stories : []
    }));
  }, fromMemory);
}

export async function getLatestEditionDate(): Promise<string | null> {
  const db = getDb();
  const fromMemory = () => memoryRecords()[0]?.date ?? null;
  if (!db) {
    return fromMemory();
  }

  return withMemoryFallback(async () => {
    const [row] = await db
      .select({ date: editions.date })
      .from(editions)
      .orderBy(desc(editions.date))
      .limit(1);
    return row?.date ?? null;
  }, fromMemory);
}

export async function getAdjacentEditionDates(date: string): Promise<{
  previousDate: string | null;
  nextDate: string | null;
}> {
  function fromMemory() {
    const dates = [...(memoryStoreHolder.__siliconGazetteMemory?.keys() ?? [])].sort();
    const index = dates.indexOf(date);
    if (index === -1) {
      return { previousDate: null, nextDate: null };
    }
    return {
      previousDate: index > 0 ? dates[index - 1] : null,
      nextDate: index < dates.length - 1 ? dates[index + 1] : null
    };
  }

  const db = getDb();

  if (!db) {
    return fromMemory();
  }

  return withMemoryFallback(async () => {
    const [[previous], [next]] = await Promise.all([
      db
        .select({ date: editions.date })
        .from(editions)
        .where(lt(editions.date, date))
        .orderBy(desc(editions.date))
        .limit(1),
      db
        .select({ date: editions.date })
        .from(editions)
        .where(gt(editions.date, date))
        .orderBy(asc(editions.date))
        .limit(1)
    ]);

    return {
      previousDate: previous?.date ?? null,
      nextDate: next?.date ?? null
    };
  }, fromMemory);
}

export async function checkDatabaseHealth(): Promise<{
  configured: boolean;
  connected: boolean;
  editionsTableExists: boolean;
  detail: string;
}> {
  if (!process.env.DATABASE_URL) {
    return {
      configured: false,
      connected: false,
      editionsTableExists: false,
      detail: "DATABASE_URL is not set. Using in-memory fallback."
    };
  }

  try {
    const client = neon(process.env.DATABASE_URL);
    await client`select 1`;

    const tableCheck = await client`
      select exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'editions'
      ) as exists
    `;

    const exists = Boolean(tableCheck[0]?.exists);
    return {
      configured: true,
      connected: true,
      editionsTableExists: exists,
      detail: exists
        ? "Connected to Neon and editions table is available."
        : "Connected to Neon, but editions table is missing. Run: npx drizzle-kit push"
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      configured: true,
      connected: false,
      editionsTableExists: false,
      detail: `Database connection failed: ${detail}`
    };
  }
}
