// OWNER: booking-pages. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /{handle}/{eventSlug} placeholder (ARCHITECTURE section 3.1, SPEC BK-03..BK-08): renders inside PublicPageShell and answers 404 for unknown
// handle, eventSlug. The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PublicCard } from "@/components/public/public-card";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { and, eq, isNull } from "drizzle-orm";
import { eventTypes, handles } from "@/db/schema";
import { getDb } from "@/db";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Book a meeting" };

type Props = {
  params: Promise<{ handle: string; eventSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ params, searchParams }: Props) {
  const [{ handle, eventSlug }] = await Promise.all([params, searchParams]);
  const db = await getDb();
  const slug = decodeURIComponent(handle).toLowerCase();
  const [owner] = await db
    .select({ userId: handles.userId, teamId: handles.teamId })
    .from(handles)
    .where(eq(handles.slug, slug))
    .limit(1);
  if (!owner) notFound();
  const ownerCondition = owner.teamId
    ? eq(eventTypes.teamId, owner.teamId)
    : and(eq(eventTypes.ownerUserId, String(owner.userId)), eq(eventTypes.scope, "personal"), isNull(eventTypes.teamId));
  const [eventType] = await db
    .select({ name: eventTypes.name })
    .from(eventTypes)
    .where(and(ownerCondition, eq(eventTypes.slug, decodeURIComponent(eventSlug)), eq(eventTypes.type, "standard"), isNull(eventTypes.deletedAt)))
    .limit(1);
  if (!eventType) notFound();
  return (
    <PublicPageShell>
      <PublicCard width="wide">
        <div className="p-8">
          <PageHeader title={eventType.name} />
          <EmptyState heading="This page is being built." />
        </div>
      </PublicCard>
    </PublicPageShell>
  );
}
