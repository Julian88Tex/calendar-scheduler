// The requester's working hours for the creation grid shading (SPEC MP-02; research meeting-polls.md B3.1): the default
// schedule's weekly hours, date-specific hours and observed holidays (no hours), as instants over the local dates the
// requested range touches in the schedule's zone. Server only.
import "server-only";
import { DateTime } from "luxon";
import { getDefaultSchedule, loadScheduleInput } from "@/lib/availability";
import { localDate, workingIntervals } from "./grid";

const MAX_DAYS = 70;

export async function getAvailabilityDefaults(
  userId: string,
  start: Date,
  end: Date,
): Promise<{ workingHours: { start: string; end: string }[]; timeZone: string | null }> {
  const schedule = await getDefaultSchedule(userId);
  if (!schedule) return { workingHours: [], timeZone: null };
  const input = await loadScheduleInput(schedule.id, { start, end });
  if (!input) return { workingHours: [], timeZone: null };
  const first = localDate(start.getTime(), input.timeZone);
  const last = localDate(end.getTime(), input.timeZone);
  const dates: string[] = [];
  for (let d = DateTime.fromISO(first, { zone: "utc" }); dates.length < MAX_DAYS; d = d.plus({ days: 1 })) {
    const iso = d.toISODate()!;
    if (iso > last) break;
    dates.push(iso);
  }
  const blocked = new Set(input.blockedDates);
  const overrides: Record<string, { start: number; end: number }[]> = { ...input.overrides };
  for (const date of blocked) overrides[date] = [];
  const intervals = workingIntervals({ timeZone: input.timeZone, weekly: input.weekly, overrides }, dates);
  return {
    workingHours: intervals
      .filter((i) => i.end > start.getTime() && i.start < end.getTime())
      .map((i) => ({ start: new Date(i.start).toISOString(), end: new Date(i.end).toISOString() })),
    timeZone: input.timeZone,
  };
}
