// OWNER: api-v1. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/integrations/api placeholder (ARCHITECTURE section 3.1, SPEC API-01). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "API" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function APIPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="API" back={{ href: "/app/integrations", label: "Integrations & apps" }} />
      <EmptyState heading="This page is being built." />
    </>
  );
}
