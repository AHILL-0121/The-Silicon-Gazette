import { NextResponse } from "next/server";

import { isValidEditionDate } from "@/lib/date";
import { getEditionForDate } from "@/lib/edition-service";
import { logServerError } from "@/lib/logger";

type RouteContext = {
  params: {
    date: string;
  };
};

export async function GET(_: Request, { params }: RouteContext) {
  const { date } = params;
  if (!isValidEditionDate(date)) {
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
  }

  try {
    const result = await getEditionForDate(date, { allowGenerate: false });
    if (!result.edition) {
      return NextResponse.json({ error: `No edition found for ${date}` }, { status: 404 });
    }

    return NextResponse.json({
      edition: result.edition
    });
  } catch (error) {
    logServerError("api:get-edition", error);
    return NextResponse.json({ error: "Failed to fetch edition." }, { status: 500 });
  }
}