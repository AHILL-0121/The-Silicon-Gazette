import { neon } from "@neondatabase/serverless";
import { asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import { editions } from "./schema";
import type { Category, EditionRecord, EditionSummary, GazetteEdition } from "./types";

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
  const message = error instanceof Error ? error.message : String(error);
  console.warn(
    `[db] Falling back to in-memory store because the editions table is unavailable: ${message}`
  );
  console.warn("[db] Run `npx drizzle-kit push` to create the schema in your Neon database.");
}

function getDb() {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  const client = neon(process.env.DATABASE_URL, {
    fetchOptions: {
      cache: "no-store"
    }
  });
  return drizzle(client);
}

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
    category: record.content.headline.category,
    story_headlines: record.content.stories.map((story) => story.headline)
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

/** Lightweight listing for the archive: never loads full story bodies. */
export async function listEditionSummaries(): Promise<EditionSummary[]> {
  const db = getDb();
  const fromMemory = () => memoryRecords().map(toSummary);
  if (!db) {
    return fromMemory();
  }

  return withMemoryFallback(async () => {
    const rows = await db
      .select({
        date: editions.date,
        issueNum: editions.issueNum,
        generatedAt: editions.generatedAt,
        title: sql<string>`${editions.content}->'headline'->>'title'`,
        deck: sql<string>`${editions.content}->'headline'->>'deck'`,
        category: sql<string>`${editions.content}->'headline'->>'category'`,
        storyHeadlines: sql<string[] | null>`jsonb_path_query_array(${editions.content}, '$.stories[*].headline')`
      })
      .from(editions)
      .orderBy(desc(editions.date));

    return rows.map((row) => ({
      date: row.date,
      issue_num: row.issueNum,
      generated_at: typeof row.generatedAt === "string" ? row.generatedAt : row.generatedAt.toISOString(),
      title: row.title ?? "",
      deck: row.deck ?? "",
      category: (row.category ?? "TECH") as Category,
      story_headlines: Array.isArray(row.storyHeadlines) ? row.storyHeadlines : []
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
