// OWNER: routing-forms. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /r/{slug} placeholder (ARCHITECTURE section 3.1, SPEC RF-11): renders inside PublicPageShell and answers 404 for unknown
// slug. The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PublicCard } from "@/components/public/public-card";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { notFound } from "next/navigation";
import { routingForms } from "@/db/schema";

export const metadata: Metadata = { title: "Routing form", robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ params, searchParams }: Props) {
  const [{ slug }] = await Promise.all([params, searchParams]);
  const db = await getDb();
  const [form] = await db
    .select({ name: routingForms.name })
    .from(routingForms)
    .where(and(eq(routingForms.slug, decodeURIComponent(slug)), eq(routingForms.status, "published"), isNull(routingForms.deletedAt)))
    .limit(1);
  if (!form) notFound();
  return (
    <PublicPageShell>
      <PublicCard width="narrow">
        <div className="p-8">
          <PageHeader title={form.name} />
          <EmptyState heading="This page is being built." />
        </div>
      </PublicCard>
    </PublicPageShell>
  );
}
