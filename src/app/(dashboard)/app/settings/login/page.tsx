// OWNER: settings-onboarding. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/settings/login placeholder (ARCHITECTURE section 3.1, SPEC AU-09, AU-10). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Login preferences" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginPreferencesPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="Login preferences" />
      <EmptyState heading="This page is being built." />
    </>
  );
}
