// OWNER: booking-pages. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /{handle} placeholder (ARCHITECTURE section 3.1, SPEC BK-01, BK-02): renders inside PublicPageShell and answers 404 for unknown
// handle. The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PublicCard } from "@/components/public/public-card";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { handles, teams, users } from "@/db/schema";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Scheduling page" };

type Props = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ params, searchParams }: Props) {
  const [{ handle }] = await Promise.all([params, searchParams]);
  const db = await getDb();
  const slug = decodeURIComponent(handle).toLowerCase();
  const [owner] = await db
    .select({ userId: handles.userId, teamId: handles.teamId })
    .from(handles)
    .where(eq(handles.slug, slug))
    .limit(1);
  if (!owner) notFound();
  let name: string | null = null;
  if (owner.userId) {
    const [user] = await db.select({ name: users.name }).from(users).where(and(eq(users.id, owner.userId), isNull(users.deletedAt))).limit(1);
    name = user?.name ?? null;
  } else if (owner.teamId) {
    const [team] = await db.select({ name: teams.name }).from(teams).where(and(eq(teams.id, owner.teamId), isNull(teams.deletedAt))).limit(1);
    name = team?.name ?? null;
  }
  if (!name) notFound();
  return (
    <PublicPageShell>
      <PublicCard width="default">
        <div className="p-8">
          <PageHeader title={name} />
          <EmptyState heading="This page is being built." />
        </div>
      </PublicCard>
    </PublicPageShell>
  );
}
