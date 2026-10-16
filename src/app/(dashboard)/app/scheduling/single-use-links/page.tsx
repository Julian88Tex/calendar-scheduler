// OWNER: links-sharing. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/scheduling/single-use-links placeholder (ARCHITECTURE section 3.1, SPEC OO-03). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Single-use links" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SingleUseLinksPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <EmptyState heading="This page is being built." />
    </>
  );
}
