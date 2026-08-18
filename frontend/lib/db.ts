import { neon } from "@neondatabase/serverless";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import { editions } from "./schema";
import type { EditionRecord, GazetteEdition } from "./types";

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
  const sql = neon(process.env.DATABASE_URL, {
    fetchOptions: {
      cache: "no-store"
    }
  });
  return drizzle(sql);
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

export async function getEditionByDate(date: string): Promise<EditionRecord | null> {
  const db = getDb();
  if (!db) {
    return memoryStoreHolder.__siliconGazetteMemory?.get(date) ?? null;
  }

  try {
    const rows = await db.select().from(editions).where(eq(editions.date, date)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return toRecord(row);
  } catch (error) {
    if (shouldFallbackToMemory(error)) {
      warnMemoryFallback(error);
      return memoryStoreHolder.__siliconGazetteMemory?.get(date) ?? null;
    }
    throw error;
  }
}

export async function saveEdition(input: SaveEditionInput): Promise<EditionRecord> {
  function saveToMemory(): EditionRecord {
    const existing = memoryStoreHolder.__siliconGazetteMemory?.get(input.date);
    const record: EditionRecord = {
      id: existing?.id ?? (memoryStoreHolder.__siliconGazetteCounter as number),
      date: input.date,
      issue_num: input.issue_num,
      content: input.content,
      generated_at: new Date().toISOString(),
      model: input.model,
      latency_ms: input.latency_ms
    };

    if (!existing) {
      memoryStoreHolder.__siliconGazetteCounter =
        (memoryStoreHolder.__siliconGazetteCounter as number) + 1;
    }
    memoryStoreHolder.__siliconGazetteMemory?.set(input.date, record);
    return record;
  }

  const db = getDb();
  if (!db) {
    return saveToMemory();
  }

  try {
    const [row] = await db
      .insert(editions)
      .values({
        date: input.date,
        issueNum: input.issue_num,
        content: input.content,
        latencyMs: input.latency_ms,
        model: input.model
      })
      .onConflictDoUpdate({
        target: editions.date,
        set: {
          issueNum: input.issue_num,
          content: input.content,
          latencyMs: input.latency_ms,
          model: input.model
        }
      })
      .returning();

    return toRecord(row);
  } catch (error) {
    if (shouldFallbackToMemory(error)) {
      warnMemoryFallback(error);
      return saveToMemory();
    }
    throw error;
  }
}

export async function listEditions(): Promise<EditionRecord[]> {
  const db = getDb();
  if (!db) {
    return memoryRecords();
  }

  try {
    const rows = await db.select().from(editions).orderBy(desc(editions.date));
    return rows.map(toRecord);
  } catch (error) {
    if (shouldFallbackToMemory(error)) {
      warnMemoryFallback(error);
      return memoryRecords();
    }
    throw error;
  }
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

  try {
    const [previous] = await db
      .select({ date: editions.date })
      .from(editions)
      .where(lt(editions.date, date))
      .orderBy(desc(editions.date))
      .limit(1);

    const [next] = await db
      .select({ date: editions.date })
      .from(editions)
      .where(gt(editions.date, date))
      .orderBy(asc(editions.date))
      .limit(1);

    return {
      previousDate: previous?.date ?? null,
      nextDate: next?.date ?? null
    };
  } catch (error) {
    if (shouldFallbackToMemory(error)) {
      warnMemoryFallback(error);
      return fromMemory();
    }
    throw error;
  }
}

export async function listEditionDates(): Promise<string[]> {
  const rows = await listEditions();
  return rows.map((row) => row.date);
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
    const sql = neon(process.env.DATABASE_URL);
    await sql`select 1`;

    const tableCheck = await sql`
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