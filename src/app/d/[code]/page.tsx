// OWNER: booking-pages. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /d/{code} placeholder (ARCHITECTURE section 3.1, SPEC BK-27): renders inside PublicPageShell and answers 404 for unknown
// code. The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PublicCard } from "@/components/public/public-card";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { and, eq, isNull } from "drizzle-orm";
import { eventTypes, oneOffMeetings, singleUseLinks } from "@/db/schema";
import { getDb } from "@/db";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Book a meeting", robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ params, searchParams }: Props) {
  const [{ code }] = await Promise.all([params, searchParams]);
  const db = await getDb();
  const value = decodeURIComponent(code);
  const [link] = await db
    .select({ eventTypeId: singleUseLinks.eventTypeId })
    .from(singleUseLinks)
    .where(and(eq(singleUseLinks.code, value), isNull(singleUseLinks.deletedAt)))
    .limit(1);
  const [oneOff] = link
    ? []
    : await db
        .select({ eventTypeId: oneOffMeetings.eventTypeId })
        .from(oneOffMeetings)
        .where(and(eq(oneOffMeetings.code, value), isNull(oneOffMeetings.deletedAt)))
        .limit(1);
  const eventTypeId = link?.eventTypeId ?? oneOff?.eventTypeId ?? null;
  const [eventType] = await db
    .select({ name: eventTypes.name })
    .from(eventTypes)
    .where(and(eventTypeId ? eq(eventTypes.id, eventTypeId) : eq(eventTypes.shareCode, value), isNull(eventTypes.deletedAt)))
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
