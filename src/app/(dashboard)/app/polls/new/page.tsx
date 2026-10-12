// OWNER: polls-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/polls/new placeholder (ARCHITECTURE section 3.1, SPEC MP-02..MP-05). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Create a meeting poll" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CreateAMeetingPollPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="Create a meeting poll" />
      <EmptyState heading="This page is being built." />
    </>
  );
}
