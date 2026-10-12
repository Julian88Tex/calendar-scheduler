// OWNER: polls-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/scheduling/meeting-polls placeholder (ARCHITECTURE section 3.1, SPEC MP-01). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Meeting polls" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function MeetingPollsPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <EmptyState heading="This page is being built." />
    </>
  );
}
