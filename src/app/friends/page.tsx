// /friends: the old friends link. Friends mode now lives on the public pages (lib/friends.ts), so this answers with a
// redirect to the instance owner's /{handle}?friends=1 (the rest of the query kept); 404 before anyone signed up.
import type { Route } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { friendsHandle, friendsQuery } from "@/components/booking/server/friends";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Page({ searchParams }: Props) {
  const [handle, sp] = await Promise.all([friendsHandle(), searchParams]);
  if (!handle) notFound();
  permanentRedirect(`/${encodeURIComponent(handle)}?${friendsQuery(sp)}` as Route);
}
