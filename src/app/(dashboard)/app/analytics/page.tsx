// OWNER: analytics. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/analytics placeholder (ARCHITECTURE section 3.1, SPEC AN-01..AN-12). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Analytics" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AnalyticsPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="Analytics" />
      <EmptyState heading="This page is being built." />
    </>
  );
}
