// OWNER: settings-onboarding. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/settings/import placeholder (ARCHITECTURE section 3.1, SPEC BR-17). The owner replaces it with the real page.
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Import from Calendly" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ImportFromCalendlyPage({ searchParams }: Props) {
  await searchParams;
  return (
    <>
      <PageHeader title="Import from Calendly" />
      <EmptyState heading="This page is being built." />
    </>
  );
}
