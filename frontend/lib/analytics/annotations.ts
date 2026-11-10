import { and, asc, eq, gte, lte } from "drizzle-orm";

import { db } from "@/lib/db";

import { analyticsAnnotations } from "./schema";

export interface Annotation {
    id: number;
    day: string;
    label: string;
}

/** Annotations dated inside [from, to] (UTC days, inclusive). */
export async function listAnnotations(from: string, to: string): Promise<Annotation[]> {
    const rows = await db
        .select({ id: analyticsAnnotations.id, day: analyticsAnnotations.day, label: analyticsAnnotations.label })
        .from(analyticsAnnotations)
        .where(and(gte(analyticsAnnotations.day, from), lte(analyticsAnnotations.day, to)))
        .orderBy(asc(analyticsAnnotations.day), asc(analyticsAnnotations.id));
    return rows;
}

export async function addAnnotation(day: string, label: string): Promise<Annotation> {
    const [row] = await db
        .insert(analyticsAnnotations)
        .values({ day, label })
        .returning({ id: analyticsAnnotations.id, day: analyticsAnnotations.day, label: analyticsAnnotations.label });
    return row;
}

export async function deleteAnnotation(id: number): Promise<boolean> {
    const rows = await db.delete(analyticsAnnotations).where(eq(analyticsAnnotations.id, id)).returning({ id: analyticsAnnotations.id });
    return rows.length > 0;
}
