// OWNER: calendar-integrations. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /app/integrations/calendars/[provider] placeholder (ARCHITECTURE section 3.1, SPEC CAL-21): google, microsoft,
// icloud, caldav and ics; other providers answer 404. The owner replaces it with the real page.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Calendar integration" };

const TITLES: Record<string, string> = {
  google: "Google Calendar",
  microsoft: "Office 365 / Outlook.com",
  icloud: "iCloud Calendar",
  caldav: "CalDAV",
  ics: "ICS feed",
};

type Props = {
  params: Promise<{ provider: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CalendarIntegrationPage({ params, searchParams }: Props) {
  const [{ provider }] = await Promise.all([params, searchParams]);
  const title = TITLES[provider];
  if (!title) notFound();
  return (
    <>
      <PageHeader title={title} back={{ href: "/app/integrations", label: "Integrations & apps" }} />
      <EmptyState heading="This page is being built." />
    </>
  );
}
