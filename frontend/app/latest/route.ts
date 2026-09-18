import { NextResponse } from "next/server";

import { readLatestEditionDate } from "@/lib/edition-service";
import { logServerError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Redirects to the most recent edition that was actually printed. */
export async function GET(request: Request) {
  try {
    const date = await readLatestEditionDate();
    return NextResponse.redirect(new URL(date ? `/gazette/${date}` : "/archive", request.url), 307);
  } catch (error) {
    logServerError("latest", error);
    return NextResponse.redirect(new URL("/archive", request.url), 307);
  }
}
