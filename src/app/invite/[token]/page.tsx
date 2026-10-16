// OWNER: teams-org. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /invite/{token} placeholder (ARCHITECTURE section 3.1, SPEC TM-03, GEN-08 (accept and decline are POST actions)): renders inside PublicPageShell and answers 404 for unknown
// token. The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PublicCard } from "@/components/public/public-card";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { getPendingInvitation } from "@/lib/teams";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Accept invitation", robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ params, searchParams }: Props) {
  const [{ token }] = await Promise.all([params, searchParams]);
  const invitation = await getPendingInvitation(decodeURIComponent(token));
  if (!invitation) notFound();
  return (
    <PublicPageShell>
      <PublicCard width="narrow">
        <div className="p-8">
          <PageHeader title={`Join ${invitation.organizationName}`} />
          <EmptyState heading="This page is being built." />
        </div>
      </PublicCard>
    </PublicPageShell>
  );
}
