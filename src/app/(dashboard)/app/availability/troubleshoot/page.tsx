// Short alias for the Troubleshoot view: /app/availability/troubleshoot?eventType=&date= redirects to the canonical
// /app/availability/advanced/troubleshoot route and keeps the query string.
import type { Route } from "next";
import { redirect } from "next/navigation";
import { TROUBLESHOOT_PATH } from "@/lib/availability/links";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function TroubleshootAliasPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value)) for (const v of value) query.append(key, v);
  }
  const qs = query.toString();
  redirect((qs ? `${TROUBLESHOOT_PATH}?${qs}` : TROUBLESHOOT_PATH) as Route);
}
