// OWNER: marketing-site. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /help placeholder (ARCHITECTURE section 3.1, SPEC GEN-19, MK-04). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Help center" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function HelpCenterPage({ searchParams }: Props) {
  await searchParams;
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-16">
      <PageHeader title="Help center" />
      <EmptyState heading="This page is being built." />
    </main>
  );
}
