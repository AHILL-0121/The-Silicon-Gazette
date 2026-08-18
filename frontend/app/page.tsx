import { redirect } from "next/navigation";

import { toEditionDate } from "@/lib/date";

export const dynamic = "force-dynamic";

export default function HomePage() {
  redirect(`/gazette/${toEditionDate()}`);
}