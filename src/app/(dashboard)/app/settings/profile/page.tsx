// OWNER: settings-onboarding. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/settings/profile placeholder (ARCHITECTURE section 3.1, SPEC BR-01..BR-04, AU-15). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Profile" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ProfilePage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="Profile" />
      <EmptyState heading="This page is being built." />
    </>
  );
}
