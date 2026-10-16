// OWNER: payments. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/integrations/stripe placeholder (ARCHITECTURE section 3.1, SPEC PAY-01). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Stripe" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function StripePage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="Stripe" back={{ href: "/app/integrations", label: "Integrations & apps" }} />
      <EmptyState heading="This page is being built." />
    </>
  );
}
