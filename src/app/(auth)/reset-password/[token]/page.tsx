// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /reset-password/[token] placeholder (ARCHITECTURE section 3.1, SPEC AU-07). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ChooseANewPasswordPage({ params, searchParams }: Props) {
  await Promise.all([params, searchParams]);
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-16">
      <PageHeader title="Choose a new password" />
      <EmptyState heading="This page is being built." />
    </main>
  );
}
