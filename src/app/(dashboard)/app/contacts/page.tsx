// OWNER: contacts. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/contacts placeholder (ARCHITECTURE section 3.1, SPEC CT-01..CT-13). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Contacts" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ContactsPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="Contacts" />
      <EmptyState heading="This page is being built." />
    </>
  );
}
