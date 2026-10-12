// OWNER: webhooks-embed. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/integrations/embed placeholder (ARCHITECTURE section 3.1, SPEC API-13, API-14). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Embed" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function EmbedPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="Embed" back={{ href: "/app/integrations", label: "Integrations & apps" }} />
      <EmptyState heading="This page is being built." />
    </>
  );
}
