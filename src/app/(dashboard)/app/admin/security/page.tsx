// OWNER: admin-compliance. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/admin/security placeholder (ARCHITECTURE section 3.1, SPEC ADM-08). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Security" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SecurityPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="Security" />
      <EmptyState heading="This page is being built." />
    </>
  );
}
