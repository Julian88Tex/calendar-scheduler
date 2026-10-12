// Shared fixtures of the booking-core integration tests: a Los Angeles host with a Mon to Fri 09:00 to 17:00 schedule
// and a solo event type, plus readable time helpers. Mocks (calendars, links, polls, the event registry) are declared
// in each test file (vi.mock is hoisted per file).
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { eventTypes, users } from "@/db/schema";
import type { LocationConfig, WeeklyHours } from "@/db/types";
import type { ExternalBusy } from "@/lib/calendars";
import { loadEventType } from "@/lib/booking/target";
import type { BookingTarget, CreateBookingInput } from "@/lib/booking/types";
import { at as localAt } from "@/lib/slots/testing";
import { createEventType, createSchedule, createUser, type CreateEventTypeOptions, type TestUser } from "../factories";

export const LA = "America/Los_Angeles";
export const MIN = 60_000;

/** "YYYY-MM-DD HH:MM" in Los Angeles to a Date. */
export const la = (local: string): Date => new Date(localAt(local, LA));
/** "HH:MM" of an instant in Los Angeles. */
export const laTime = (ms: number | Date): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone: LA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));

const r = (from: string, to: string) => {
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  return { start: fh! * 60 + fm!, end: th! * 60 + tm! };
};
export const WEEKDAYS: WeeklyHours = [[], [r("09:00", "17:00")], [r("09:00", "17:00")], [r("09:00", "17:00")], [r("09:00", "17:00")], [r("09:00", "17:00")], []];
export const hours = (from: string, to: string): WeeklyHours => [[], [r(from, to)], [r(from, to)], [r(from, to)], [r(from, to)], [r(from, to)], []];
export const everyDay = (from: string, to: string): WeeklyHours => [[r(from, to)], [r(from, to)], [r(from, to)], [r(from, to)], [r(from, to)], [r(from, to)], [r(from, to)]];

export const MEET: LocationConfig = { id: "5eed0000-0000-4000-8000-000000000101", kind: "google_conference", position: 0 };
export const DISCUSS = { label: "What would you like to discuss?", type: "text" as const, required: true };

export type Fixture = { owner: TestUser; scheduleId: string; target: BookingTarget; reload: () => Promise<BookingTarget> };

/** A Los Angeles host, a default schedule and a 30 minute solo event type (increments 30, no buffers, no notice). */
export async function setupSolo(
  db: DbOrTx,
  opts: {
    weeklyHours?: WeeklyHours;
    user?: Partial<typeof users.$inferInsert>;
    eventType?: Partial<typeof eventTypes.$inferInsert>;
    questions?: CreateEventTypeOptions["questions"];
    locations?: LocationConfig[];
    owner?: TestUser;
  } = {},
): Promise<Fixture> {
  const owner = opts.owner ?? (await createUser(db, { timezone: LA, overrides: opts.user }));
  const schedule = await createSchedule(db, { userId: owner.id, timezone: LA, weeklyHours: opts.weeklyHours ?? WEEKDAYS });
  const { eventType } = await createEventType(db, {
    owner,
    durationMinutes: 30,
    locations: opts.locations ?? [MEET],
    questions: opts.questions,
    overrides: {
      slotIncrementMinutes: 30,
      minimumNoticeMinutes: 0,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      dateRangeType: "rolling",
      dateRangeDays: 60,
      ...opts.eventType,
    },
  });
  const reload = async (): Promise<BookingTarget> => ({ kind: "event_type", eventType: (await loadEventType(eventType.id, db))! });
  return { owner, scheduleId: schedule.id, target: await reload(), reload };
}

export async function updateEventType(db: DbOrTx, id: string, set: Partial<typeof eventTypes.$inferInsert>): Promise<void> {
  await db.update(eventTypes).set(set).where(eq(eventTypes.id, id));
}

export async function updateUser(db: DbOrTx, id: string, set: Partial<typeof users.$inferInsert>): Promise<void> {
  await db.update(users).set(set).where(eq(users.id, id));
}

/** An external busy event (timed or all-day by calendar dates). */
export function ext(start: Date | string, end: Date | string, title: string | null = "Busy", extra: Partial<ExternalBusy> = {}): ExternalBusy {
  return {
    start: new Date(start),
    end: new Date(end),
    allDay: false,
    title,
    calendarId: "cal-1",
    externalId: `ext-${Math.random().toString(36).slice(2)}`,
    ...extra,
  };
}

/** A booking request for the fixture's event type. */
export function bookingInput(target: BookingTarget, start: Date | string, over: Partial<CreateBookingInput> = {}): CreateBookingInput {
  return {
    target: { kind: "event_type", eventTypeId: target.eventType.id },
    start: new Date(start).toISOString(),
    invitee: { name: "Ana Lima", email: `ana.${Math.random().toString(36).slice(2, 8)}@example.com`, timezone: "America/New_York" },
    answers: target.eventType.questions.map((q) => ({ questionId: q.id, value: "Roadmap" })),
    ...over,
  };
}

/** Local "HH:MM" starts of slots on one Los Angeles date. */
export function startsOn(slots: { start: number }[], date: string): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: LA, year: "numeric", month: "2-digit", day: "2-digit" });
  return slots.filter((s) => fmt.format(new Date(s.start)) === date).map((s) => laTime(s.start));
}
