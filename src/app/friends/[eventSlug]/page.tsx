// /friends/{eventSlug}: the old friends link booking page; redirects to /{handle}/{eventSlug}?friends=1 (query kept).
import type { Route } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { friendsHandle, friendsQuery } from "@/components/booking/server/friends";

type Props = {
  params: Promise<{ eventSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ params, searchParams }: Props) {
  const [handle, { eventSlug }, sp] = await Promise.all([friendsHandle(), params, searchParams]);
  if (!handle) notFound();
  permanentRedirect(`/${encodeURIComponent(handle)}/${encodeURIComponent(eventSlug)}?${friendsQuery(sp)}` as Route);
}
