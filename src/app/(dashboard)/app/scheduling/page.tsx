// OWNER: event-types-list.
//
// /app/scheduling, the Event types tab (ARCHITECTURE section 3.1; SPEC ET-02 to ET-09, ET-12, ET-33; walkthrough 5.1
// and 5.2; docs/SCOPE.md: one person, one-on-one event types). The Scheduling layout renders the "Scheduling" header
// with "+ Create" and the tabs; this page loads the user's personal event types (listEventTypes, ordered by position
// like the landing page) with the user's link and renders the list (search and filters from the URL query), streaming
// a skeleton while it loads.
import type { Metadata } from "next";
import { Suspense } from "react";
import { getActorCtx } from "@/lib/authz";
import { listEventTypes } from "@/lib/event-types";
import { fileUrl } from "@/lib/files";
import { absoluteUrl, appHost } from "@/lib/url";
import { EventTypesSkeleton } from "./_components/event-types-skeleton";
import { EventTypesView } from "./_components/event-types-view";
import { parseListFilters, type ListFilters } from "./_components/list-filters";

export const metadata: Metadata = { title: "Scheduling" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function EventTypesPage({ searchParams }: Props) {
  const filters = parseListFilters(await searchParams);
  return (
    <Suspense fallback={<EventTypesSkeleton />}>
      <EventTypesList filters={filters} />
    </Suspense>
  );
}

async function EventTypesList({ filters }: { filters: ListFilters }) {
  const actor = await getActorCtx();
  const { user } = actor;
  const items = await listEventTypes(actor);
  const profile = {
    name: user.name,
    avatarUrl: user.avatarFileId ? fileUrl(user.avatarFileId) : (user.avatarUrl ?? null),
    publicUrl: user.slug ? absoluteUrl(`/${user.slug}`) : null,
    linkLabel: user.slug ? `${appHost()}/${user.slug}` : null,
  };
  return <EventTypesView profile={profile} items={items} initialFilters={filters} />;
}
