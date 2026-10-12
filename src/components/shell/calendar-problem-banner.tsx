// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// CalendarProblemBanner (SPEC CAL-15): shown when a calendar connection needs attention (calendars.getCalendarHealth).
import Link from "next/link";
import { Banner } from "../ui/banner";

export type CalendarProblemBannerProps = { brokenConnections: { id: string; email: string | null; status: string }[] };

export function CalendarProblemBanner({ brokenConnections }: CalendarProblemBannerProps) {
  if (!brokenConnections.length) return null;
  const first = brokenConnections[0];
  return (
    <Banner variant="warning" dismissible action={<Link href="/app/availability/calendar-settings">Reconnect</Link>}>
      {`We can't reach your calendar${first?.email ? ` ${first.email}` : ""}. Reconnect it so we can check for conflicts.`}
    </Banner>
  );
}
