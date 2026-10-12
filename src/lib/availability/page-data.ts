// Data of the Schedules tab (/app/availability, SPEC AV-01 to AV-10): the user's named schedules, the selected one
// with its weekly and date-specific hours, the "Active on" event types, and the user's display settings.
import "server-only";
import { getDb } from "@/db";
import type { UserRow } from "@/lib/auth/session";
import { hour12For } from "@/lib/time/format";
import { localDateOf } from "@/lib/time/luxon";
import { now } from "@/lib/time/now";
import { zoneOrUtc } from "@/lib/time/zones";
import { ensureDefaultSchedule } from "./core";
import { getSchedule, listActiveOnEventTypes, listSchedules, type ActiveOnEventType, type ScheduleDetail, type ScheduleSummary } from "./schedules";

export type SchedulesPageData = {
  schedules: ScheduleSummary[];
  selected: ScheduleDetail;
  eventTypes: ActiveOnEventType[];
  /** Today in the selected schedule's zone ("YYYY-MM-DD"). */
  today: string;
  hour12: boolean;
  weekStart: 0 | 1;
  profileZone: string;
};

export async function loadSchedulesPage(
  user: Pick<UserRow, "id" | "timezone" | "timeFormat" | "weekStart" | "locale">,
  opts: { scheduleId?: string | null } = {},
): Promise<SchedulesPageData> {
  const db = await getDb();
  let schedules = await listSchedules(user.id, db);
  if (!schedules.some((s) => s.isDefault)) {
    // AV-15: repair a missing default (promotes the oldest schedule or creates "Working hours").
    await db.transaction((tx) => ensureDefaultSchedule(tx, user.id, { timezone: user.timezone }));
    schedules = await listSchedules(user.id, db);
  }
  const fallback = schedules.find((s) => s.isDefault) ?? schedules[0]!;
  const wanted = opts.scheduleId && schedules.some((s) => s.id === opts.scheduleId) ? opts.scheduleId : fallback.id;
  const selected = (await getSchedule(user.id, wanted, db)) ?? (await getSchedule(user.id, fallback.id, db));
  if (!selected) throw new Error("loadSchedulesPage: default schedule missing");
  const eventTypes = await listActiveOnEventTypes(user.id, db);
  return {
    schedules,
    selected,
    eventTypes,
    today: localDateOf(now(), selected.timezone),
    hour12: hour12For(user.timeFormat, user.locale ?? "en"),
    weekStart: user.weekStart === 1 ? 1 : 0,
    profileZone: zoneOrUtc(user.timezone),
  };
}
