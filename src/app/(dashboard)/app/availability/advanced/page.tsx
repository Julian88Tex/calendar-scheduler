// OWNER: availability. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/availability/advanced placeholder (ARCHITECTURE section 3.1, SPEC AV-13..AV-15). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Advanced settings" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdvancedSettingsPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <EmptyState heading="This page is being built." />
    </>
  );
}
