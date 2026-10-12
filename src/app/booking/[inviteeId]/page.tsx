// OWNER: booking-pages. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /booking/{inviteeId} placeholder (ARCHITECTURE section 3.1, SPEC BK-20): renders inside PublicPageShell and answers 404 for unknown
// inviteeId. The owner replaces it with the real page.
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

export const metadata: Metadata = { title: "You are scheduled", robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ inviteeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ params, searchParams }: Props) {
  const [{ inviteeId }] = await Promise.all([params, searchParams]);
  if (!isUuid(inviteeId)) notFound();
  const db = await getDb();
  const [invitee] = await db.select({ id: invitees.id }).from(invitees).where(eq(invitees.id, inviteeId)).limit(1);
  if (!invitee) notFound();
  return (
    <PublicPageShell>
      <PublicCard width="narrow">
        <div className="p-8">
          <PageHeader title={"You are scheduled"} />
          <EmptyState heading="This page is being built." />
        </div>
      </PublicCard>
    </PublicPageShell>
  );
}
