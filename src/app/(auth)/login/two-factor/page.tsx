// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /login/two-factor placeholder (ARCHITECTURE section 3.1, SPEC AU-09). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Two-factor authentication", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function TwoFactorAuthenticationPage({ searchParams }: Props) {
  await searchParams;
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-16">
      <PageHeader title="Two-factor authentication" />
      <EmptyState heading="This page is being built." />
    </main>
  );
}
