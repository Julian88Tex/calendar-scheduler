// OWNER: lifecycle-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /reschedulings/{inviteeId}/{start} placeholder (ARCHITECTURE section 3.1, SPEC CR-03): renders inside PublicPageShell and answers 404 for unknown
// inviteeId, start. Never framed (frame-ancestors 'none'). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PublicCard } from "@/components/public/public-card";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { invitees } from "@/db/schema";
import { isUuid } from "@/lib/ids";
import { notFound } from "next/navigation";
import { parseStartParam } from "@/lib/url";

export const metadata: Metadata = { title: "Reschedule Event", robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ inviteeId: string; start: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ params, searchParams }: Props) {
  const [{ inviteeId, start }] = await Promise.all([params, searchParams]);
  if (!parseStartParam(start)) notFound();
  if (!isUuid(inviteeId)) notFound();
  const db = await getDb();
  const [invitee] = await db.select({ id: invitees.id }).from(invitees).where(eq(invitees.id, inviteeId)).limit(1);
  if (!invitee) notFound();
  return (
    <PublicPageShell>
      <PublicCard width="narrow">
        <div className="p-8">
          <PageHeader title={"Reschedule Event"} />
          <EmptyState heading="This page is being built." />
        </div>
      </PublicCard>
    </PublicPageShell>
  );
}
