// OWNER: calendar-integrations. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/availability/calendar-settings placeholder (ARCHITECTURE section 3.1, SPEC CAL-01..CAL-19). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Calendar settings" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CalendarSettingsPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <EmptyState heading="This page is being built." />
    </>
  );
}
