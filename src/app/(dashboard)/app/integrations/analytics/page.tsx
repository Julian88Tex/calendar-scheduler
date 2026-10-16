// OWNER: analytics. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/integrations/analytics placeholder (ARCHITECTURE section 3.1, SPEC AN-13). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Google Analytics and Meta Pixel" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function GoogleAnalyticsAndMetaPixelPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="Google Analytics and Meta Pixel" back={{ href: "/app/integrations", label: "Integrations & apps" }} />
      <EmptyState heading="This page is being built." />
    </>
  );
}
