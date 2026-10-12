// OWNER: routing-forms. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/routing placeholder (ARCHITECTURE section 3.1, SPEC RF-01). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Routing" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function RoutingPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="Routing" />
      <EmptyState heading="This page is being built." />
    </>
  );
}
