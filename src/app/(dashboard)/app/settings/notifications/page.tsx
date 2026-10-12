// OWNER: settings-onboarding. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/settings/notifications placeholder (ARCHITECTURE section 3.1, SPEC NT-21). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Notifications" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function NotificationsPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="Notifications" />
      <EmptyState heading="This page is being built." />
    </>
  );
}
