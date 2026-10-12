// Pure booking helpers shared by the server and the booking pages (client safe: no I/O, no "server-only").
//
//   groupSlotsByLocalDate(slots, zone)    the BK-31 `days` map grouped by the invitee zone's local dates (SCH-22)
//   firstAvailableDate(days)              the earliest date key with at least one slot
//   localDateRange(startDate, endDate, z) [start of startDate, start of endDate + 1 day) in zone z (DST safe)
import type { Slot } from "@/lib/slots/types";
import { dayFromIso, isoFromDay, zoneClock } from "@/lib/slots/zone";

export type SlotDays = Record<string, { start: string; remaining: number }[]>;

/** Groups slots by their local date in `zone`: { "2026-10-14": [{ start: ISO, remaining }] }. */
export function groupSlotsByLocalDate(slots: Slot[], zone: string): SlotDays {
  const clock = zoneClock(zone);
  const out: SlotDays = {};
  for (const s of slots) {
    const day = isoFromDay(clock.localDay(s.start));
    (out[day] ??= []).push({ start: new Date(s.start).toISOString(), remaining: s.inviteesRemaining });
  }
  return out;
}

/** The earliest local date with at least one slot, or null. */
export function firstAvailableDate(days: SlotDays): string | null {
  let best: string | null = null;
  for (const [date, list] of Object.entries(days)) {
    if (list.length > 0 && (best === null || date < best)) best = date;
  }
  return best;
}

/** Instants bounding the local dates startDate..endDate (inclusive) in `zone`. */
export function localDateRange(startDate: string, endDate: string, zone: string): { start: Date; end: Date } {
  const clock = zoneClock(zone);
  const start = clock.startOfDay(dayFromIso(startDate));
  const end = clock.startOfDay(dayFromIso(endDate) + 1);
  return { start: new Date(start), end: new Date(end) };
}

/** Number of local dates in startDate..endDate (inclusive). */
export function localDateSpan(startDate: string, endDate: string): number {
  return dayFromIso(endDate) - dayFromIso(startDate) + 1;
}
