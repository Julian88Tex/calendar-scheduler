// OWNER: workflows. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/workflows/new placeholder (ARCHITECTURE section 3.1, SPEC NT-11..NT-13). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Create workflow" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CreateWorkflowPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="Create workflow" />
      <EmptyState heading="This page is being built." />
    </>
  );
}
