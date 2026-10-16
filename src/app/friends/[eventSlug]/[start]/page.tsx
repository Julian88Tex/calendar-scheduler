// /friends/{eventSlug}/{start}: the old friends link details step; redirects to /{handle}/{eventSlug}/{start}?friends=1.
import type { Route } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { friendsHandle, friendsQuery } from "@/components/booking/server/friends";

type Props = {
  params: Promise<{ eventSlug: string; start: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ params, searchParams }: Props) {
  const [handle, { eventSlug, start }, sp] = await Promise.all([friendsHandle(), params, searchParams]);
  if (!handle) notFound();
  permanentRedirect(`/${encodeURIComponent(handle)}/${encodeURIComponent(eventSlug)}/${encodeURIComponent(start)}?${friendsQuery(sp)}` as Route);
}
