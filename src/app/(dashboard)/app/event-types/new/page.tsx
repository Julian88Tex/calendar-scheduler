// OWNER: event-types-editor. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/event-types/new placeholder (ARCHITECTURE section 3.1, SPEC ET-10..ET-33). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "New event type" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function NewEventTypePage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="New event type" />
      <EmptyState heading="This page is being built." />
    </>
  );
}
