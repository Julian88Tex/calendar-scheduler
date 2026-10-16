// OWNER: links-sharing. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/one-off/new placeholder (ARCHITECTURE section 3.1, SPEC OO-05..OO-07). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Create a one-off meeting" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CreateAOneOffMeetingPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="Create a one-off meeting" />
      <EmptyState heading="This page is being built." />
    </>
  );
}
