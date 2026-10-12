// OWNER: settings-onboarding. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /onboarding placeholder (ARCHITECTURE section 3.1, SPEC AU-12): the full-screen wizard (no sidebar) for signed-in
// users. The owner replaces it with the real wizard.
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: "Welcome", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function OnboardingPage({ searchParams }: Props) {
  await searchParams;
  await requireUser();
  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-16">
      <PageHeader title={`Create your ${APP_NAME} URL`} />
      <EmptyState
        heading="This page is being built."
        action={
          <Link href="/app/scheduling" className="text-primary-text underline">
            Go to Scheduling
          </Link>
        }
      />
    </main>
  );
}
