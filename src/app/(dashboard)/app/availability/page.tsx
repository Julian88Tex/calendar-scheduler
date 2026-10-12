// OWNER: availability. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/availability placeholder (ARCHITECTURE section 3.1, SPEC AV-01..AV-12). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Availability" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SchedulesPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <EmptyState heading="This page is being built." />
    </>
  );
}
