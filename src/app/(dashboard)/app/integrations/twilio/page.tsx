// OWNER: workflows. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/integrations/twilio placeholder (ARCHITECTURE section 3.1, SPEC NT-16). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Twilio" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function TwilioPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="Twilio" back={{ href: "/app/integrations", label: "Integrations & apps" }} />
      <EmptyState heading="This page is being built." />
    </>
  );
}
