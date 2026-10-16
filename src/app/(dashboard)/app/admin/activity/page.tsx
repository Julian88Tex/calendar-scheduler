// OWNER: admin-compliance. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/admin/activity placeholder (ARCHITECTURE section 3.1, SPEC GEN-17). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Activity log" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ActivityLogPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="Activity log" />
      <EmptyState heading="This page is being built." />
    </>
  );
}
