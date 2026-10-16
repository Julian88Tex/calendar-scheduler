// OWNER: workflows.
//
// /app/integrations/twilio: Text reminders (Twilio SMS) are not part of this build (docs/SCOPE.md: workflows lite sends email reminders only).
// There is no navigation to this route; it answers 404 so no placeholder UI is shown.
import { notFound } from "next/navigation";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function TwilioPage({ searchParams }: Props) {
  await searchParams;
  notFound();
}
