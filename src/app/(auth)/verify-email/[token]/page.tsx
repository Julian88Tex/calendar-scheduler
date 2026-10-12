// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /verify-email/[token] placeholder (ARCHITECTURE section 3.1, SPEC AU-08). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Verify your email", robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function VerifyYourEmailPage({ params, searchParams }: Props) {
  await Promise.all([params, searchParams]);
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-16">
      <PageHeader title="Verify your email" />
      <EmptyState heading="This page is being built." />
    </main>
  );
}
