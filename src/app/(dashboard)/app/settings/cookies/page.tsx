// OWNER: settings-onboarding. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/settings/cookies placeholder (ARCHITECTURE section 3.1, SPEC BR-12). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Cookie settings" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CookieSettingsPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="Cookie settings" />
      <EmptyState heading="This page is being built." />
    </>
  );
}
