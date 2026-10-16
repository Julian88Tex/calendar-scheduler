// OWNER: payments. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /payments/return placeholder (ARCHITECTURE section 3.1, SPEC PAY-02, PAY-03): the Stripe Checkout return (also the
// embed popup return, which posts kairos:payment_complete to the opener). The owner replaces it with the real page.
import type { Metadata } from "next";
import { PublicCard } from "@/components/public/public-card";
import { PublicPageShell } from "@/components/public/public-page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Payment", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PaymentReturnPage({ searchParams }: Props) {
  await searchParams;
  return (
    <PublicPageShell>
      <PublicCard width="narrow">
        <div className="p-8">
          <PageHeader title="Payment" />
          <EmptyState heading="This page is being built." />
        </div>
      </PublicCard>
    </PublicPageShell>
  );
}
