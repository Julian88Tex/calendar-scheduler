// /app/availability/advanced/troubleshoot, the Troubleshoot view (docs/SCOPE.md priority 4; SPEC SCH-21, BK-24): pick a
// date (and optionally an event type and duration) to list every candidate start time with its status and the exact
// reason: outside working hours, a conflicting calendar event with its title, a buffer before or after a named event,
// minimum notice, beyond the date range, event type daily/weekly/monthly limits, host meeting limits, an existing
// booking or a held time. Host-only: it diagnoses the signed-in user's own availability. Booking pages link here from
// the owner banner with troubleshootHref({ eventTypeId, date }) (@/lib/availability/links).
//   ?date=YYYY-MM-DD   local date (default today in the schedule zone)
//   ?eventType={id}    one event type (default: every event type)
//   ?duration={min}    one of the event type's durations
import type { Metadata } from "next";
import { getActorCtx } from "@/lib/authz";
import { getTroubleshootDay } from "@/lib/availability/troubleshoot";
import { TroubleshootView } from "./_components/troubleshoot-view";

export const metadata: Metadata = { title: "Troubleshoot availability" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function TroubleshootPage({ searchParams }: Props) {
  const [actor, sp] = await Promise.all([getActorCtx(), searchParams]);
  const duration = Number(first(sp.duration));
  const day = await getTroubleshootDay(actor, {
    date: first(sp.date) ?? null,
    eventTypeId: first(sp.eventType) ?? null,
    durationMinutes: Number.isInteger(duration) && duration > 0 ? duration : null,
  });
  return <TroubleshootView key={`${day.date}:${day.eventTypeId ?? "all"}:${day.durationMinutes ?? ""}`} day={day} />;
}
