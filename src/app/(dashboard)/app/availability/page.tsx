// OWNER: availability.
//
// /app/availability, the Schedules tab (SPEC AV-01 to AV-10, AV-15; walkthrough 9.2). Server Component: loads the
// user's schedules (repairing a missing default), the selected schedule (?schedule={id}, else the default) with every
// date-specific override, the "Active on" event types and the display settings, then renders the auto-saving editor.
// ?view=calendar opens the Calendar view.
import type { Metadata } from "next";
import { getActorCtx } from "@/lib/authz";
import { loadSchedulesPage } from "@/lib/availability/page-data";
import { SchedulesView } from "./_components/schedules-view";

export const metadata: Metadata = { title: "Availability" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SchedulesPage({ searchParams }: Props) {
  const [actor, sp] = await Promise.all([getActorCtx(), searchParams]);
  const data = await loadSchedulesPage(actor.user, { scheduleId: first(sp.schedule) ?? null });
  return (
    <SchedulesView
      key={data.selected.id}
      schedules={data.schedules}
      schedule={data.selected}
      eventTypes={data.eventTypes}
      today={data.today}
      hour12={data.hour12}
      weekStart={data.weekStart}
      view={first(sp.view) === "calendar" ? "calendar" : "list"}
    />
  );
}
