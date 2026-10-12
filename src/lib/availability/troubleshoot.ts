// Troubleshoot page data (docs/SCOPE.md priority 4; SPEC SCH-21, BK-24): one local date of the owner's availability,
// for one or every event type: every candidate start with its status and reasons (from booking-core's
// troubleshootAvailability, built on the slot engine diagnostics), plus the context the page shows next to it: the
// hours each schedule offers that day, the host meeting limits with this day's, week's and month's counts, and the
// event types to choose from.
import "server-only";
import { troubleshootAvailability } from "@/lib/booking";
import type { TroubleshootResult } from "@/lib/booking/types";
import type { ActorCtx } from "@/lib/authz";
import { isAppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { hoursForDate } from "@/lib/slots";
import { hour12For } from "@/lib/time/format";
import { addDays, localDateOf, startOfLocalDay } from "@/lib/time/luxon";
import { now } from "@/lib/time/now";
import { zoneOrUtc } from "@/lib/time/zones";
import { getDefaultSchedule, loadScheduleInput } from "./core";
import { isIsoDate } from "./intervals";
import { countHostMeetings, getMeetingLimits } from "./limits";
import { listActiveOnEventTypes, listSchedules } from "./schedules";
import type { HostMeetingCounts, TroubleshootDay, TroubleshootScheduleHours } from "./types";

export type { TroubleshootDay, TroubleshootScheduleHours } from "./types";

/** Dates the troubleshooter accepts: about ten years around today. */
const MAX_DAYS_AWAY = 3650;

export function clampTroubleshootDate(date: string | null | undefined, today: string): string {
  if (!date || !isIsoDate(date)) return today;
  const min = addDays(today, -MAX_DAYS_AWAY);
  const max = addDays(today, MAX_DAYS_AWAY);
  return date < min || date > max ? today : date;
}

/**
 * The Troubleshoot view of one local date (in the selected event type's schedule zone, else the default schedule's)
 * for the signed-in user. Failures of the diagnostics are returned as `error` (the page shows them inline).
 */
export async function getTroubleshootDay(
  actor: Pick<ActorCtx, "orgId" | "orgRole"> & { user: Pick<ActorCtx["user"], "id" | "timezone" | "timeFormat" | "weekStart" | "locale"> },
  input: { date?: string | null; eventTypeId?: string | null; durationMinutes?: number | null },
): Promise<TroubleshootDay> {
  const userId = actor.user.id;
  const [eventTypes, schedules, defaultSchedule, hostLimits] = await Promise.all([
    listActiveOnEventTypes(userId),
    listSchedules(userId),
    getDefaultSchedule(userId),
    getMeetingLimits(userId),
  ]);
  const selected = input.eventTypeId ? (eventTypes.find((e) => e.id === input.eventTypeId) ?? null) : null;
  const scheduleNames: Record<string, string> = Object.fromEntries(schedules.map((s) => [s.id, s.name]));

  // Zone: the selected event type's schedule (named or custom), else the default schedule, else the profile zone.
  const scheduleZoneById = new Map(schedules.map((s) => [s.id, s.timezone]));
  let zone = zoneOrUtc(defaultSchedule?.timezone ?? actor.user.timezone);
  if (selected?.scheduleId) {
    const known = scheduleZoneById.get(selected.scheduleId);
    const custom = known ? null : await loadScheduleInput(selected.scheduleId, { start: now(), end: now() });
    zone = zoneOrUtc(known ?? custom?.timeZone ?? zone);
  }

  const today = localDateOf(now(), zone);
  const date = clampTroubleshootDate(input.date, today);
  const start = startOfLocalDay(date, zone);
  const end = startOfLocalDay(addDays(date, 1), zone);

  const durationAllowed = selected && input.durationMinutes && selected.durationOptions.includes(input.durationMinutes) ? input.durationMinutes : null;

  // The hours each relevant schedule offers on the date.
  const relevant = (selected ? [selected] : eventTypes).filter((e) => e.scheduleId);
  const scheduleHours: Record<string, TroubleshootScheduleHours> = {};
  for (const et of relevant) {
    const id = et.scheduleId!;
    if (scheduleHours[id]) continue;
    const loaded = await loadScheduleInput(id, { start, end });
    if (!loaded) continue;
    const h = hoursForDate(loaded, date);
    scheduleHours[id] = {
      scheduleId: id,
      name: et.custom ? `${et.name} custom hours` : (scheduleNames[id] ?? "Schedule"),
      timezone: loaded.timeZone,
      custom: et.custom,
      eventTypeId: et.custom ? et.id : null,
      intervals: h.source === "holiday" ? h.holidayRanges : h.ranges,
      source: h.source,
    };
  }

  let result: TroubleshootResult | null = null;
  let error: string | null = null;
  if (eventTypes.length > 0) {
    try {
      result = await troubleshootAvailability(
        { userId, organizationId: actor.orgId, orgRole: actor.orgRole },
        { eventTypeId: selected?.id ?? null, start, end, durationMinutes: durationAllowed ?? undefined, now: now() },
      );
    } catch (e) {
      if (isAppError(e) && e.code !== "internal") {
        error = e.code === "not_configured" ? "Troubleshooting isn't available right now. Try again later." : e.message;
      } else {
        log.error("availability.troubleshoot_failed", { userId, error: e });
        error = "We couldn't check your availability. Try again.";
      }
    }
  }

  let hostCounts: HostMeetingCounts | null = null;
  try {
    hostCounts = await countHostMeetings(userId, date);
  } catch (e) {
    log.warn("availability.troubleshoot_counts_failed", { userId, error: e });
  }

  return {
    date,
    today,
    zone,
    hour12: hour12For(actor.user.timeFormat, actor.user.locale ?? "en"),
    weekStart: actor.user.weekStart === 1 ? 1 : 0,
    eventTypeId: selected?.id ?? null,
    durationMinutes: durationAllowed,
    eventTypes,
    scheduleNames,
    scheduleHours,
    hostLimits,
    hostCounts,
    result,
    error,
  };
}
