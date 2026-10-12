// OWNER: marketing-site. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /privacy placeholder (ARCHITECTURE section 3.1, SPEC MK-03). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Privacy Policy" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PrivacyPolicyPage({ searchParams }: Props) {
  await searchParams;
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-16">
      <PageHeader title="Privacy Policy" />
      <EmptyState heading="This page is being built." />
    </main>
  );
}
