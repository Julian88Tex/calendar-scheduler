// OWNER: workflows. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/workflows/[id] placeholder (ARCHITECTURE section 3.1, SPEC NT-11..NT-13). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Edit workflow" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EditWorkflowPage({ params, searchParams }: Props) {
  await Promise.all([params, searchParams]);
  return (
    <>
      <PageHeader title="Edit workflow" />
      <EmptyState heading="This page is being built." />
    </>
  );
}
