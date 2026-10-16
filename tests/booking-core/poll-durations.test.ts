// Long and all-day meeting poll bookings (SPEC MP-18; docs/SCOPE.md meeting polls): a booking made through a poll (its
// adhoc event type with booking method "poll", or a caller with a poll context) may last a whole local day
// (MAX_POLL_DURATION_MINUTES: 24 hours, 25 on a daylight saving fall-back day), while regular event types, other adhoc
// types and host "Customize this meeting" durations keep the 12 hour cap.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/calendars", () => ({
  getExternalBusy: async (p: { userIds: string[] }) => Object.fromEntries(p.userIds.map((id) => [id, { ok: true, stale: false, nocal: false, busy: [] }])),
  getDestinationCalendar: async () => null,
}));
vi.mock("@/lib/links", () => ({
  resolveBookingCode: async () => null,
  consumeLinkInTx: async () => {},
  getReservedIntervals: async () => ({}),
  LinkUsedError: class LinkUsedError extends Error {},
}));
const polls = vi.hoisted(() => ({ booked: [] as Record<string, unknown>[] }));
vi.mock("@/lib/polls", () => ({
  getPollReservedIntervals: async () => ({}),
  markPollBookedInTx: async (_tx: unknown, p: Record<string, unknown>) => {
    polls.booked.push(p);
  },
}));
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const schema = await import("@/db/schema");
const { invitees, meetingPolls, scheduledEvents } = schema;
const { createBooking } = await import("@/lib/booking/create");
const { getAvailability } = await import("@/lib/booking/availability");
const { MESSAGES } = await import("@/lib/booking/validate");
const { loadEventType } = await import("@/lib/booking/target");
const f = await import("../factories");
const { MAX_DURATION_MINUTES, MAX_POLL_DURATION_MINUTES, isPollEventType, maxDurationOf, resolveDuration } = await import("@/lib/booking/rules");
const { useTestDb } = await import("../helpers/db");
const h = await import("./helpers");
const { la, setupSolo, bookingInput, MIN } = h;
type Fixture = Awaited<ReturnType<typeof setupSolo>>;

const t = useTestDb();
const NOW = la("2030-10-07 08:00");
const ctx = { now: NOW };

beforeEach(() => {
  polls.booked = [];
});

/** A booking target whose event type has only the fields the duration rules read. */
function target(et: { type: "standard" | "adhoc"; bookingMethod?: "instant" | "poll"; durationMinutes?: number; durationOptions?: number[] | null }) {
  return {
    eventType: { durationMinutes: 60, durationOptions: null, bookingMethod: "instant", ...et } as unknown as Fixture["target"]["eventType"],
  };
}

describe("duration rules (SCH-18, MP-18)", () => {
  const regular = target({ type: "standard", durationMinutes: 30, durationOptions: [30, 60] });
  const oneOff = target({ type: "adhoc", bookingMethod: "instant" });
  const pollType = target({ type: "adhoc", bookingMethod: "poll" });

  it("recognizes the poll's adhoc event type", () => {
    expect(isPollEventType(pollType.eventType)).toBe(true);
    expect(isPollEventType(oneOff.eventType)).toBe(false);
    expect(isPollEventType({ type: "standard", bookingMethod: "poll" })).toBe(false);
  });

  it("keeps the 12 hour cap for regular event types and other adhoc types", () => {
    expect(MAX_DURATION_MINUTES).toBe(720);
    expect(maxDurationOf(regular)).toBe(720);
    expect(maxDurationOf(oneOff)).toBe(720);
    expect(resolveDuration(regular, 60)).toBe(60);
    expect(resolveDuration(regular, 45)).toBeNull();
    expect(resolveDuration(regular, null)).toBe(30);
    expect(resolveDuration(oneOff, 720)).toBe(720);
    expect(resolveDuration(oneOff, 721)).toBeNull();
  });

  it("gives poll bookings a whole local day: 24 hours, 25 on a fall-back day, never more than 26", () => {
    expect(MAX_POLL_DURATION_MINUTES).toBe(26 * 60);
    expect(maxDurationOf(pollType)).toBe(MAX_POLL_DURATION_MINUTES);
    expect(maxDurationOf(oneOff, { poll: true })).toBe(MAX_POLL_DURATION_MINUTES);
    for (const minutes of [721, 1080, 1440, 1500, MAX_POLL_DURATION_MINUTES]) expect(resolveDuration(pollType, minutes)).toBe(minutes);
    expect(resolveDuration(oneOff, 1440, { poll: true })).toBe(1440);
    expect(resolveDuration(pollType, MAX_POLL_DURATION_MINUTES + 1)).toBeNull();
    expect(resolveDuration(pollType, 0)).toBeNull();
    expect(resolveDuration(pollType, 90.5)).toBeNull();
    // A poll context never widens the choices of a regular event type.
    expect(resolveDuration(regular, 1440, { poll: true })).toBeNull();
  });
});

describe("createBooking through a meeting poll (MP-18)", () => {
  const POLL_TYPE = { type: "adhoc", bookingMethod: "poll", secret: true, minimumNoticeMinutes: 0, dateRangeType: "unlimited" } as const;
  type Poll = { owner: Fixture["owner"]; target: Fixture["target"]; pollId: string };

  /** A poll with its own adhoc event type (one poll per event type, decision C2) for the fixture's owner. */
  async function newPoll(fx: Fixture, first = false): Promise<Poll> {
    const target = first
      ? fx.target
      : { kind: "event_type" as const, eventType: (await loadEventType((await f.createEventType(t.db, { owner: fx.owner, type: "adhoc", overrides: POLL_TYPE })).eventType.id))! };
    const [row] = await t.db
      .insert(meetingPolls)
      .values({
        eventTypeId: target.eventType.id,
        organizationId: fx.owner.organizationId,
        ownerUserId: fx.owner.id,
        slug: `p${Math.random().toString(36).slice(2, 12)}`,
        title: "Offsite",
        defaultDurationMinutes: 60,
        timezone: h.LA,
      })
      .returning();
    return { owner: fx.owner, target, pollId: row!.id };
  }

  async function pollFixture(): Promise<{ fx: Fixture; poll: Poll }> {
    const fx = await setupSolo(t.db, { eventType: POLL_TYPE });
    return { fx, poll: await newPoll(fx, true) };
  }

  function pollBooking(p: Poll, start: Date, end: Date) {
    return {
      ...bookingInput(p.target, start, { invitee: { name: "Voter One", email: "one@example.com", timezone: h.LA } }),
      durationMinutes: Math.round((end.getTime() - start.getTime()) / MIN),
      actor: { type: "host" as const, userId: p.owner.id },
      pollContext: {
        pollId: p.pollId,
        optionId: "00000000-0000-4000-8000-0000000000b1",
        bookedByUserId: p.owner.id,
        participants: [
          { participantId: null, name: "Voter One", email: "one@example.com", timezone: h.LA },
          { participantId: null, name: "Voter Two", email: "two@example.com" },
        ],
      },
    };
  }

  async function bookedMeeting(id: string) {
    const [ev] = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, id));
    return ev!;
  }

  it("books a whole day (an all-day option) and an 18 hour option, outside working hours", async () => {
    const { fx, poll } = await pollFixture();
    const day = await createBooking(pollBooking(poll, la("2030-10-12 00:00"), la("2030-10-13 00:00")), ctx);
    expect(day.ok).toBe(true);
    if (!day.ok) return;
    const ev = await bookedMeeting(day.scheduledEventId);
    expect(ev).toMatchObject({ source: "poll", durationMinutes: 1440, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
    expect(ev.startAt.toISOString()).toBe(la("2030-10-12 00:00").toISOString());
    expect(ev.endAt.toISOString()).toBe(la("2030-10-13 00:00").toISOString());
    const rows = await t.db.select().from(invitees).where(eq(invitees.scheduledEventId, ev.id));
    expect(rows.map((r) => r.email).sort()).toEqual(["one@example.com", "two@example.com"]);

    const long = await createBooking(pollBooking(await newPoll(fx), la("2030-10-15 06:00"), la("2030-10-16 00:00")), ctx);
    expect(long.ok).toBe(true);
    if (!long.ok) return;
    expect((await bookedMeeting(long.scheduledEventId)).durationMinutes).toBe(18 * 60);
    expect(polls.booked).toHaveLength(2);
  });

  it("books the 25 hour local day of a daylight saving fall-back change", async () => {
    const { poll } = await pollFixture();
    const start = la("2030-11-03 00:00");
    const end = la("2030-11-04 00:00");
    expect((end.getTime() - start.getTime()) / MIN).toBe(25 * 60);
    const r = await createBooking(pollBooking(poll, start, end), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ev = await bookedMeeting(r.scheduledEventId);
    expect(ev.durationMinutes).toBe(1500);
    expect(ev.endAt.toISOString()).toBe(end.toISOString());
  });

  it("refuses more than a whole day, and the poll's meeting still blocks the owner's other bookings", async () => {
    const { fx, poll } = await pollFixture();
    const from = la("2030-10-12 00:00");
    const tooLong = await createBooking(pollBooking(poll, from, new Date(from.getTime() + (MAX_POLL_DURATION_MINUTES + 30) * MIN)), ctx);
    expect(tooLong).toMatchObject({ ok: false, code: "validation" });

    const r = await createBooking(pollBooking(poll, la("2030-10-09 00:00"), la("2030-10-10 00:00")), ctx);
    expect(r.ok).toBe(true);
    const { eventType } = await f.createEventType(t.db, {
      owner: fx.owner,
      durationMinutes: 30,
      overrides: { slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, dateRangeType: "rolling", dateRangeDays: 60 },
    });
    const regular = { kind: "event_type" as const, eventType: (await loadEventType(eventType.id))! };
    const slots = await getAvailability({ target: regular, start: la("2030-10-09 00:00"), end: la("2030-10-11 00:00"), now: NOW });
    expect(h.startsOn(slots.slots, "2030-10-09")).toEqual([]);
    expect(h.startsOn(slots.slots, "2030-10-10")).toContain("09:00");
  });

  it("regular bookings keep the 12 hour cap, also for host customized durations (OO-13)", async () => {
    const fx = await setupSolo(t.db);
    const customized = await createBooking(
      bookingInput(fx.target, la("2030-10-08 09:00"), { actor: { type: "host", userId: fx.owner.id, customize: { durationMinutes: MAX_DURATION_MINUTES + 1 } } }),
      ctx,
    );
    expect(customized).toMatchObject({ ok: false, code: "validation", message: MESSAGES.duration });
    const asked = await createBooking(bookingInput(fx.target, la("2030-10-08 09:00"), { durationMinutes: 1440 }), ctx);
    expect(asked).toMatchObject({ ok: false, code: "validation" });
  });
});
