// OWNER: links-sharing. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/one-off/[id] placeholder (ARCHITECTURE section 3.1, SPEC OO-05..OO-07). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "One-off meeting" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OneOffMeetingPage({ params, searchParams }: Props) {
  await Promise.all([params, searchParams]);
  return (
    <>
      <PageHeader title="One-off meeting" />
      <EmptyState heading="This page is being built." />
    </>
  );
}
