// Shared fixtures of the lifecycle-core integration tests (PGlite): a Los Angeles host with an every-day 09:00 to 17:00
// schedule and a 30 minute Google Meet event type with one required question, optionally a Google Calendar connection
// as the destination (the fake provider of tests/helpers/fake-providers.ts plugged in by each test file's vi.mock),
// real bookings through booking-core, and a job drain that runs the lifecycle subscriber and job handlers through the
// real job runner. Mocks are declared in each test file (vi.mock is hoisted per file).
import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import type { DB } from "@/db";
import { calendarLinkedEvents, emailOutbox, invitees, jobs, scheduledEvents, users } from "@/db/schema";
import type { LocationConfig, WeeklyHours } from "@/db/types";
import { createBooking } from "@/lib/booking/create";
import type { CreateBookingInput, CreateBookingResult } from "@/lib/booking/types";
import { runDueJobs } from "@/lib/jobs";
import { now, setFakeNow } from "@/lib/time/now";
import { createCalendarConnection, createEventType, createSchedule, createUser, type CreateEventTypeOptions, type TestUser } from "../factories";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const LA = "America/Los_Angeles";
/** Monday 2030-10-07 08:00 in Los Angeles. */
export const NOW = new Date("2030-10-07T15:00:00Z");

const all = [{ start: 9 * 60, end: 17 * 60 }];
export const EVERY_DAY: WeeklyHours = [all, all, all, all, all, all, all];

export const MEET: LocationConfig = { id: "5eed0000-0000-4000-8000-0000000000a1", kind: "google_conference", position: 0 };
export const CAFE: LocationConfig = { id: "5eed0000-0000-4000-8000-0000000000a2", kind: "physical", position: 1, location: "Blue Bottle, 66 Mint St" };
export const DISCUSS = { label: "What would you like to discuss?", type: "text" as const, required: true };

/** "2030-10-08 10:00" in Los Angeles. */
export function la(local: string): Date {
  const [d, t] = local.split(" ");
  // PDT (UTC-7) holds for every October date these tests use before Nov 3, 2030.
  return new Date(`${d}T${t}:00-07:00`);
}

export type Fixture = {
  owner: TestUser;
  eventTypeId: string;
  calendarId: string | null;
  connectionId: string | null;
  questionIds: string[];
};

export async function setupHost(
  db: DB,
  opts: {
    google?: boolean;
    name?: string;
    email?: string;
    locations?: LocationConfig[];
    eventType?: Partial<NonNullable<CreateEventTypeOptions["overrides"]>>;
    kind?: "solo" | "group";
    maxInvitees?: number;
    userOverrides?: Partial<typeof users.$inferInsert>;
    includeBuffers?: boolean;
  } = {},
): Promise<Fixture> {
  const owner = await createUser(db, { name: opts.name ?? "Julian Joseph", email: opts.email, timezone: LA, overrides: opts.userOverrides });
  await createSchedule(db, { userId: owner.id, timezone: LA, weeklyHours: EVERY_DAY });
  const { eventType, questions } = await createEventType(db, {
    owner,
    name: "30 Minute Virtual",
    slug: "30min",
    durationMinutes: 30,
    kind: opts.kind,
    maxInvitees: opts.maxInvitees,
    locations: opts.locations ?? [MEET],
    questions: [DISCUSS],
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
  let calendarId: string | null = null;
  let connectionId: string | null = null;
  if (opts.google) {
    const { connection, calendars } = await createCalendarConnection(db, {
      userId: owner.id,
      provider: "google",
      accountEmail: owner.email,
      calendars: [{ externalId: owner.email, isPrimary: true, canWrite: true, checkConflicts: true, includeBuffers: opts.includeBuffers ?? false }],
    });
    calendarId = calendars[0]!.id;
    connectionId = connection.id;
    await db.update(users).set({ destinationCalendarId: calendarId }).where(eq(users.id, owner.id));
  }
  return { owner, eventTypeId: eventType.id, calendarId, connectionId, questionIds: (questions ?? []).map((q: { id: string }) => q.id) };
}

let seq = 0;
export function bookingInput(fx: Fixture, start: Date, over: Partial<CreateBookingInput> = {}): CreateBookingInput {
  seq++;
  return {
    target: { kind: "event_type", eventTypeId: fx.eventTypeId },
    start: start.toISOString(),
    invitee: { name: "Ana Lima", email: `ana.${seq}@example.com`, timezone: "Europe/Berlin", timeFormat: "24h" },
    answers: fx.questionIds.map((id) => ({ questionId: id, value: "The roadmap" })),
    ...over,
  };
}

export async function book(fx: Fixture, start: Date, over: Partial<CreateBookingInput> = {}): Promise<Extract<CreateBookingResult, { ok: true }>> {
  const r = await createBooking(bookingInput(fx, start, over), { now: now() });
  if (!r.ok) throw new Error(`booking failed: ${r.code} ${r.message}`);
  return r;
}

const LIFECYCLE_TYPES = [
  "event:booking.created:lifecycle",
  "event:booking.canceled:lifecycle",
  "event:booking.rescheduled:lifecycle",
  "event:meeting.updated:lifecycle",
  "lifecycle.*",
];

/**
 * Runs due lifecycle jobs (subscribers and job handlers) through the real runner until none is due, then fails the
 * test when one of them failed (the runner itself would only reschedule it).
 */
export async function drain(db: DB, rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    const r = await runDueJobs({ budgetMs: 25_000, types: LIFECYCLE_TYPES, workerId: "test" });
    if (r.ran === 0) break;
  }
  const failed = await db
    .select({ type: jobs.type, lastError: jobs.lastError, status: jobs.status })
    .from(jobs)
    .where(and(or(like(jobs.type, "event:%:lifecycle"), like(jobs.type, "lifecycle.%")), inArray(jobs.status, ["dead", "failed", "pending"])));
  const broken = failed.filter((j) => j.lastError && j.lastError !== "no_handler");
  if (broken.length) throw new Error(`lifecycle job failed: ${broken.map((b) => `${b.type}: ${b.lastError}`).join("; ")}`);
}

/** Moves the business clock forward (jobs scheduled for later become due). */
export function advance(ms: number): void {
  setFakeNow(new Date(now().getTime() + ms));
}

export async function outbox(db: DB, opts: { to?: string; template?: string; scheduledEventId?: string } = {}) {
  const rows = await db.select().from(emailOutbox).orderBy(asc(emailOutbox.createdAt));
  return rows.filter(
    (r) =>
      (!opts.to || r.toAddresses.includes(opts.to)) &&
      (!opts.template || r.template === opts.template) &&
      (!opts.scheduledEventId || r.scheduledEventId === opts.scheduledEventId),
  );
}

export async function meeting(db: DB, id: string) {
  const [m] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.id, id)).limit(1);
  if (!m) throw new Error("meeting missing");
  return m;
}

export async function invitee(db: DB, id: string) {
  const [i] = await db.select().from(invitees).where(eq(invitees.id, id)).limit(1);
  if (!i) throw new Error("invitee missing");
  return i;
}

export async function linkedRows(db: DB, scheduledEventId: string) {
  return db.select().from(calendarLinkedEvents).where(eq(calendarLinkedEvents.scheduledEventId, scheduledEventId));
}

/** ICS property lines unfolded ("UID:...", "SEQUENCE:1", "METHOD:CANCEL"). */
export function icsProps(ics: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!ics) return out;
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  for (const line of unfolded.split(/\r?\n/)) {
    const m = /^([A-Z-]+)(?:;[^:]*)?:(.*)$/.exec(line);
    if (m && !(m[1]! in out)) out[m[1]!] = m[2]!;
  }
  return out;
}
