// Test fixtures for the slot engine (used by src/lib/slots/*.test.ts and tests/slot-engine/**). Pure builders with
// readable local-time helpers; not imported by application code.
import type {
  BusyInterval,
  EventTypeRules,
  HostInput,
  Interval,
  MinuteRange,
  ScheduleInput,
  SlotEngineInput,
  SlotEngineResult,
  SlotQuery,
  WeeklyHours,
} from "./types";
import { DAY_MS, MINUTE_MS, dayFromIso, isoFromDay, zoneClock } from "./zone";

export const LA = "America/Los_Angeles";
export const NY = "America/New_York";
export const BERLIN = "Europe/Berlin";
export const LONDON = "Europe/London";
export const UTC = "UTC";

/** "HH:MM" to minutes (24:00 = 1440). */
export function hm(time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) throw new Error(`hm: invalid time ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** A local wall-clock time "YYYY-MM-DD HH:MM" in `zone` as epoch ms (gaps shift forward, overlaps take the earlier). */
export function at(local: string, zone: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})$/.exec(local);
  if (!m) throw new Error(`at: invalid local time ${local}`);
  return zoneClock(zone).wallToUtc(dayFromIso(m[1]!), hm(m[2]!));
}

/** Epoch ms of an ISO instant ("2026-10-13T22:00:00Z"). */
export function utc(isoInstant: string): number {
  const ms = Date.parse(isoInstant);
  if (!Number.isFinite(ms)) throw new Error(`utc: invalid instant ${isoInstant}`);
  return ms;
}

/** "YYYY-MM-DD HH:MM" of an instant in `zone`. */
export function localOf(ms: number, zone: string): string {
  const clock = zoneClock(zone);
  const naive = clock.toNaive(ms);
  const day = Math.floor(naive / DAY_MS);
  const minutes = Math.round((naive - day * DAY_MS) / MINUTE_MS);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${isoFromDay(day)} ${hh}:${mm}`;
}

/** "HH:MM" of an instant in `zone`. */
export function timeOf(ms: number, zone: string): string {
  return localOf(ms, zone).slice(11);
}

/** ISO instant without milliseconds ("2026-10-13T22:00:00Z"). */
export function isoOf(ms: number): string {
  return new Date(ms).toISOString().replace(".000Z", "Z");
}

type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Ranges from ["09:00", "17:00"] pairs. */
export function ranges(...pairs: [string, string][]): MinuteRange[] {
  return pairs.map(([s, e]) => ({ start: hm(s), end: hm(e) }));
}

/** Weekly hours from a per-day spec; "weekdays" fills Mon to Fri; "all" fills every day. */
export function weekly(spec: Partial<Record<DayKey | "weekdays" | "all", [string, string][]>>): WeeklyHours {
  const out: MinuteRange[][] = [[], [], [], [], [], [], []];
  if (spec.all) for (let i = 0; i < 7; i++) out[i] = ranges(...spec.all);
  if (spec.weekdays) for (let i = 1; i <= 5; i++) out[i] = ranges(...spec.weekdays);
  DAY_KEYS.forEach((k, i) => {
    const v = spec[k];
    if (v) out[i] = ranges(...v);
  });
  return out as WeeklyHours;
}

export function schedule(
  zone: string,
  weeklyHours: WeeklyHours,
  extra: { overrides?: Record<string, MinuteRange[]>; blockedDates?: string[] } = {},
): ScheduleInput {
  return { timeZone: zone, weekly: weeklyHours, overrides: extra.overrides ?? {}, blockedDates: extra.blockedDates ?? [] };
}

/** Owner's "Working hours" (observed): Sun 14-19, Mon 12-17, Tue 11-23, Wed 11-23, Thu 11-20, Fri 11-17, Sat off. */
export const OWNER_WORKING_HOURS: WeeklyHours = weekly({
  sun: [["14:00", "19:00"]],
  mon: [["12:00", "17:00"]],
  tue: [["11:00", "23:00"]],
  wed: [["11:00", "23:00"]],
  thu: [["11:00", "20:00"]],
  fri: [["11:00", "17:00"]],
});

/** Owner's "Block Off Work" (observed): Sun 13-21, Mon 17:00-17:00 (zero length), Tue-Thu 17-20, Fri 17:00-17:00. */
export const OWNER_BLOCK_OFF_WORK: WeeklyHours = weekly({
  sun: [["13:00", "21:00"]],
  mon: [["17:00", "17:00"]],
  tue: [["17:00", "20:00"]],
  wed: [["17:00", "20:00"]],
  thu: [["17:00", "20:00"]],
  fri: [["17:00", "17:00"]],
});

export function host(userId: string, partial: Partial<HostInput> = {}): HostInput {
  return {
    userId,
    schedule: null,
    busy: [],
    calendarStatus: "ok",
    hostLimits: {},
    hostLimitZone: partial.schedule?.timeZone ?? UTC,
    hostMeetingStarts: [],
    priority: 3,
    poolId: null,
    rr: null,
    ...partial,
  };
}

export function rules(partial: Partial<EventTypeRules> = {}): EventTypeRules {
  return {
    eventTypeId: "et-1",
    durationMinutes: 30,
    incrementMinutes: 30,
    alignment: "interval_start",
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minimumNoticeMinutes: 0,
    dateRange: { type: "unlimited" },
    rangeZone: UTC,
    weekStart: 0,
    limits: {},
    eventTypeMeetingStarts: [],
    kind: "solo",
    seats: 1,
    groupSlots: [],
    pooling: null,
    pools: [],
    freeBusyExceptions: [],
    spots: null,
    ...partial,
  };
}

/** A local date's full-day query range [00:00, next 00:00) in `zone`. */
export function dayRange(date: string, zone: string, days = 1): Pick<SlotQuery, "rangeStart" | "rangeEnd"> {
  const clock = zoneClock(zone);
  const d = dayFromIso(date);
  return { rangeStart: clock.startOfDay(d), rangeEnd: clock.startOfDay(d + days) };
}

export function calendarBusy(start: number, end: number, extra: Partial<BusyInterval> = {}): BusyInterval {
  return { start, end, source: "calendar", ...extra };
}

/** An app meeting busy interval expanded by its own stored buffers (minutes). */
export function meetingBusy(
  start: number,
  end: number,
  extra: Partial<BusyInterval> & { before?: number; after?: number } = {},
): BusyInterval {
  const { before = 0, after = 0, ...rest } = extra;
  return {
    start: start - before * MINUTE_MS,
    end: end + after * MINUTE_MS,
    core: { start, end },
    source: "meeting",
    meetingId: rest.meetingId ?? `m-${start}`,
    eventTypeId: rest.eventTypeId ?? "other-et",
    ...rest,
  };
}

export function reservedBusy(start: number, end: number, extra: Partial<BusyInterval> = {}): BusyInterval {
  return { start, end, source: "reserved", reservedKind: "reservation", ...extra };
}

export type RunInput = { rules: EventTypeRules; hosts: HostInput[]; query: Partial<SlotQuery> & Pick<SlotQuery, "rangeStart" | "rangeEnd"> };

/** Default `now` far in the past so notice and PAST never interfere unless a test sets it. */
export const LONG_AGO = Date.UTC(2020, 0, 1);

export function input(i: RunInput): SlotEngineInput {
  return { rules: i.rules, hosts: i.hosts, query: { now: LONG_AGO, ...i.query } };
}

/** Local "HH:MM" starts of the result's slots in `zone`. */
export function startTimes(result: SlotEngineResult, zone: string): string[] {
  return result.slots.map((s) => timeOf(s.start, zone));
}

/** Local "YYYY-MM-DD HH:MM" starts of the result's slots in `zone`. */
export function startLocals(result: SlotEngineResult, zone: string): string[] {
  return result.slots.map((s) => localOf(s.start, zone));
}

export function isoStarts(result: SlotEngineResult): string[] {
  return result.slots.map((s) => isoOf(s.start));
}

/** Every "HH:MM" from `from` to `to` inclusive stepping by `step` minutes. */
export function timesBetween(from: string, to: string, step: number): string[] {
  const out: string[] = [];
  for (let m = hm(from); m <= hm(to); m += step) {
    out.push(`${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

/** Seeded pseudo random generator (mulberry32) for property tests and selectHosts. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}
