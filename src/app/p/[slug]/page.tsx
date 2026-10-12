// OWNER: polls-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /p/{slug} placeholder (ARCHITECTURE section 3.1, SPEC MP-07..MP-09): renders inside PublicPageShell and answers 404 for unknown
// slug. The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PublicCard } from "@/components/public/public-card";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { meetingPolls } from "@/db/schema";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Meeting poll", robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ params, searchParams }: Props) {
  const [{ slug }] = await Promise.all([params, searchParams]);
  const db = await getDb();
  const [poll] = await db
    .select({ title: meetingPolls.title })
    .from(meetingPolls)
    .where(and(eq(meetingPolls.slug, decodeURIComponent(slug)), isNull(meetingPolls.deletedAt)))
    .limit(1);
  if (!poll) notFound();
  return (
    <PublicPageShell>
      <PublicCard width="narrow">
        <div className="p-8">
          <PageHeader title={poll.title} />
          <EmptyState heading="This page is being built." />
        </div>
      </PublicCard>
    </PublicPageShell>
  );
}
