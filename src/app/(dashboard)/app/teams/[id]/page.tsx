// OWNER: teams-org. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/teams/[id] placeholder (ARCHITECTURE section 3.1, SPEC TM-05). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Team settings" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TeamSettingsPage({ params, searchParams }: Props) {
  await Promise.all([params, searchParams]);
  return (
    <>
      <PageHeader title="Team settings" />
      <EmptyState heading="This page is being built." />
    </>
  );
}
