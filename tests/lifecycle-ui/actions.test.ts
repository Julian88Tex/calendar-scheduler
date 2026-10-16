// The Server Actions of the invitee pages and the host meeting dialogs on PGlite (SPEC CR-02, CR-03, CR-06, CR-07,
// CR-11, CR-14, GEN-08; ARCHITECTURE 26 rules 3, 5 and 21): the invitee cancel and reschedule actions need no session
// (the invitee id is the capability) and apply lifecycle-core's rules (the required reason, already canceled); the host
// actions refuse signed-out callers and other tenants' meetings, and the notes action answers with the sanitized HTML
// as stored. Other modules' contracts are mocked (calendars, links, polls, the event subscribers).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WeeklyHours } from "@/db/types";
import type { CreateEventTypeOptions, TestUser } from "../factories";

const session = vi.hoisted(() => ({ user: null as unknown }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3000", "x-forwarded-for": "203.0.113.7" }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getSession: async () => (session.user ? { session: { id: "s", twoFactorPending: false }, user: session.user } : null),
  getCurrentUser: async () => session.user,
  touchSession: async () => {},
}));
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
vi.mock("@/lib/polls", () => ({ getPollReservedIntervals: async () => ({}), markPollBookedInTx: async () => {} }));
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const { eq } = await import("drizzle-orm");
const { eventTypeQuestions, inviteeNoShows, invitees, scheduledEvents, users } = await import("@/db/schema");
const { cancelInviteeAction } = await import("@/app/cancellations/[inviteeId]/actions");
const { rescheduleInviteeAction } = await import("@/app/reschedulings/[inviteeId]/actions");
const actions = await import("@/components/lifecycle/actions");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { at } = await import("@/lib/slots/testing");
const { useTestDb } = await import("../helpers/db");
const f = await import("../factories");
const messages = (await import("@/lib/i18n/messages/en/lifecycle")).default;

const t = useTestDb();
const LA = "America/Los_Angeles";
const la = (local: string) => new Date(at(local, LA));
const NOW = la("2030-10-07 06:00");
const r = (from: number, to: number) => [{ start: from * 60, end: to * 60 }];
const WEEKDAYS: WeeklyHours = [[], r(9, 17), r(9, 17), r(9, 17), r(9, 17), r(9, 17), []];
const CAFE = { id: "5eed0000-0000-4000-8000-000000000402", kind: "physical" as const, position: 0, location: "Blue Bottle", displayBeforeBooking: true };
let seq = 0;

beforeEach(() => {
  setFakeNow(NOW);
  session.user = null;
});
afterEach(() => resetFakeTime());

async function host(): Promise<TestUser> {
  const owner = await f.createUser(t.db, { name: "Ana Lima", email: `ana-act-${++seq}@example.com`, timezone: LA, slug: `ana-act-${seq}` });
  await f.createSchedule(t.db, { userId: owner.id, timezone: LA, weeklyHours: WEEKDAYS });
  return owner;
}

async function signIn(user: TestUser | null) {
  if (!user) {
    session.user = null;
    return;
  }
  const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
  session.user = row;
}

async function booked(owner: TestUser, overrides: Partial<NonNullable<CreateEventTypeOptions["overrides"]>> = {}, start = la("2030-10-08 10:00")) {
  const { eventType } = await f.createEventType(t.db, {
    owner,
    name: "Intro Call",
    slug: `intro-${++seq}`,
    durationMinutes: 30,
    locations: [CAFE],
    questions: [{ label: "What would you like to discuss?", type: "text", required: true }],
    overrides: { slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, dateRangeType: "rolling", dateRangeDays: 60, ...overrides },
  });
  const [question] = await t.db.select().from(eventTypeQuestions).where(eq(eventTypeQuestions.eventTypeId, eventType.id));
  const b = await f.createBooking(t.db, {
    eventType,
    start,
    invitee: {
      name: "Ben Ortiz",
      email: `ben-${seq}@example.com`,
      timezone: "America/New_York",
      questionsAndAnswers: [{ questionId: question!.id, question: question!.label, type: "text", position: 0, answer: "Roadmap review" }],
      overrides: { locationAnswer: { configId: CAFE.id, value: null } },
    },
  });
  return { eventType, questionId: question!.id, scheduledEventId: b.scheduledEvent.id, inviteeId: b.invitee!.id, inviteeEmail: `ben-${seq}@example.com` };
}

describe("invitee cancel action (CR-02, CR-05, GEN-08)", () => {
  it("works without a session, requires the reason when the event type asks for one, and refuses a second cancel", async () => {
    const owner = await host();
    const b = await booked(owner, { requireCancelReason: true });
    const missing = await cancelInviteeAction({ inviteeId: b.inviteeId, reason: "   " });
    expect(missing).toMatchObject({ ok: false, error: { code: "validation", fieldErrors: { reason: [messages.changes.reasonRequired] } } });
    const tooLong = await cancelInviteeAction({ inviteeId: b.inviteeId, reason: "x".repeat(2001) });
    expect(tooLong).toMatchObject({ ok: false, error: { fieldErrors: { reason: [messages.changes.reasonTooLong] } } });

    const ok = await cancelInviteeAction({ inviteeId: b.inviteeId, reason: "Plans changed" });
    expect(ok).toEqual({ ok: true, data: { meetingCanceled: true } });
    const [inv] = await t.db.select().from(invitees).where(eq(invitees.id, b.inviteeId));
    expect(inv).toMatchObject({ status: "canceled", cancelerType: "invitee", cancelReason: "Plans changed" });

    const again = await cancelInviteeAction({ inviteeId: b.inviteeId, reason: "Plans changed" });
    expect(again).toMatchObject({ ok: false, error: { code: "conflict", message: messages.changes.canceled } });
  });

  it("rejects malformed ids before touching the database", async () => {
    expect(await cancelInviteeAction({ inviteeId: "not-a-uuid", reason: null })).toMatchObject({ ok: false, error: { code: "validation" } });
  });
});

describe("invitee reschedule action (CR-03, SCH-24)", () => {
  it("moves the meeting to a new time without a session and links the old invitee to the new one", async () => {
    const owner = await host();
    const b = await booked(owner);
    const res = await rescheduleInviteeAction({
      inviteeId: b.inviteeId,
      start: la("2030-10-09 11:00").toISOString(),
      durationMinutes: 30,
      reason: "A conflict came up",
      invitee: { name: "Ben Ortiz", email: b.inviteeEmail, timezone: "America/New_York" },
      guests: [],
      locationAnswer: { configId: CAFE.id, value: null },
      answers: [{ questionId: b.questionId, value: "Roadmap review" }],
      clientRequestId: "req-reschedule-1",
    });
    if (!res.ok) throw new Error(res.error.message);
    expect(res.data.type).toBe("ok");
    const newId = res.data.type === "ok" ? res.data.inviteeId : "";
    const [old] = await t.db.select().from(invitees).where(eq(invitees.id, b.inviteeId));
    expect(old).toMatchObject({ status: "canceled", rescheduled: true, newInviteeId: newId, rescheduleReason: "A conflict came up" });

    // The old invitee's link can't move the meeting again: the change rules answer, not a taken time.
    const again = await rescheduleInviteeAction({
      inviteeId: b.inviteeId,
      start: la("2030-10-10 11:00").toISOString(),
      invitee: { name: "Ben Ortiz", email: b.inviteeEmail, timezone: "America/New_York" },
      clientRequestId: "req-reschedule-2",
    });
    expect(again).toEqual({ ok: true, data: { type: "blocked", message: messages.changes.notReschedulable } });
  });

  it("answers 'blocked' for unknown invitees", async () => {
    const res = await rescheduleInviteeAction({
      inviteeId: "4b0c9f3e-0000-4000-8000-000000000000",
      start: la("2030-10-10 11:00").toISOString(),
      invitee: { name: "X", email: "x@example.com", timezone: "UTC" },
      clientRequestId: "req-reschedule-3",
    });
    expect(res).toEqual({ ok: true, data: { type: "blocked", message: messages.changes.notReschedulable } });
  });
});

describe("host dialog actions (CR-06, CR-07, CR-11, CR-14; ARCHITECTURE 26 rules 5 and 21)", () => {
  it("refuse signed-out callers", async () => {
    const owner = await host();
    const b = await booked(owner);
    for (const call of [
      actions.hostCancelMeetingAction({ scheduledEventId: b.scheduledEventId, message: null }),
      actions.hostRescheduleSlotsAction({ inviteeId: b.inviteeId, month: "2030-10", zone: LA }),
      actions.hostRescheduleNowAction({ inviteeId: b.inviteeId, start: la("2030-10-09 11:00").toISOString(), clientRequestId: "req-host-0" }),
      actions.hostRequestRescheduleAction({ inviteeId: b.inviteeId, message: null }),
      actions.setNoShowAction({ inviteeId: b.inviteeId, noShow: true }),
      actions.saveMeetingNotesAction({ scheduledEventId: b.scheduledEventId, html: "<p>x</p>" }),
    ]) {
      expect(await call).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    }
  });

  it("refuse another tenant's meeting and leave it unchanged", async () => {
    const owner = await host();
    const b = await booked(owner);
    await signIn(await host());
    const results = await Promise.all([
      actions.hostCancelMeetingAction({ scheduledEventId: b.scheduledEventId, message: "hijack" }),
      actions.hostRescheduleSlotsAction({ inviteeId: b.inviteeId, month: "2030-10", zone: LA }),
      actions.hostRescheduleNowAction({ inviteeId: b.inviteeId, start: la("2030-10-09 11:00").toISOString(), clientRequestId: "req-host-1" }),
      actions.hostRequestRescheduleAction({ inviteeId: b.inviteeId, message: null }),
      actions.saveMeetingNotesAction({ scheduledEventId: b.scheduledEventId, html: "<p>mine now</p>" }),
    ]);
    for (const res of results) {
      expect(res.ok).toBe(false);
      expect(res.ok ? null : res.error.code).toMatch(/^(not_found|forbidden)$/);
    }
    setFakeNow(la("2030-10-08 10:05"));
    const noShow = await actions.setNoShowAction({ inviteeId: b.inviteeId, noShow: true });
    expect(noShow.ok ? null : noShow.error.code).toMatch(/^(not_found|forbidden)$/);
    const [m] = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, b.scheduledEventId));
    expect(m).toMatchObject({ status: "active", meetingNotesHtml: null });
    expect(await t.db.select().from(inviteeNoShows).where(eq(inviteeNoShows.inviteeId, b.inviteeId))).toHaveLength(0);
  });

  it("saves notes and answers with the sanitized HTML as stored (CR-14)", async () => {
    const owner = await host();
    const b = await booked(owner);
    await signIn(owner);
    const res = await actions.saveMeetingNotesAction({
      scheduledEventId: b.scheduledEventId,
      html: '<p onclick="alert(1)">Prep the <strong>deck</strong></p><script>alert(2)</script><img src=x onerror="alert(3)">',
    });
    if (!res.ok) throw new Error(res.error.message);
    const [m] = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, b.scheduledEventId));
    expect(res.data.html).toBe(m!.meetingNotesHtml);
    expect(res.data.html).toContain("<strong>deck</strong>");
    expect(res.data.html).not.toMatch(/onclick|onerror|<script|alert/);
    const cleared = await actions.saveMeetingNotesAction({ scheduledEventId: b.scheduledEventId, html: "<p><br></p>" });
    expect(cleared).toEqual({ ok: true, data: { scheduledEventId: b.scheduledEventId, html: null } });
  });

  it("lists the host's times with the meeting itself ignored (CR-07, SCH-24), and marks no-shows only after the start (CR-11)", async () => {
    const owner = await host();
    const b = await booked(owner);
    await signIn(owner);
    const slots = await actions.hostRescheduleSlotsAction({ inviteeId: b.inviteeId, month: "2030-10", zone: LA });
    if (!slots.ok) throw new Error(slots.error.message);
    expect(slots.data.timeZone).toBe(LA);
    expect(slots.data.durationMinutes).toBe(30);
    expect(slots.data.days["2030-10-08"]?.map((s) => s.start)).toContain(la("2030-10-08 10:00").toISOString());
    expect(await actions.hostRescheduleSlotsAction({ inviteeId: b.inviteeId, month: "2030-10", zone: "Mars/Olympus" })).toMatchObject({ ok: false, error: { code: "validation" } });

    const early = await actions.setNoShowAction({ inviteeId: b.inviteeId, noShow: true });
    expect(early).toMatchObject({ ok: false, error: { message: messages.errors.noShowBeforeStart } });
    setFakeNow(la("2030-10-08 10:05"));
    expect(await actions.setNoShowAction({ inviteeId: b.inviteeId, noShow: true })).toEqual({ ok: true, data: { noShow: true } });
    expect(await t.db.select().from(inviteeNoShows).where(eq(inviteeNoShows.inviteeId, b.inviteeId))).toHaveLength(1);
    expect(await actions.setNoShowAction({ inviteeId: b.inviteeId, noShow: false })).toEqual({ ok: true, data: { noShow: false } });
    expect(await t.db.select().from(inviteeNoShows).where(eq(inviteeNoShows.inviteeId, b.inviteeId))).toHaveLength(0);
  });

  it("reschedules now to a host-picked slot and cancels with a message (CR-06, CR-07)", async () => {
    const owner = await host();
    const b = await booked(owner);
    await signIn(owner);
    const moved = await actions.hostRescheduleNowAction({ inviteeId: b.inviteeId, start: la("2030-10-09 13:00").toISOString(), clientRequestId: "req-host-2" });
    if (!moved.ok) throw new Error(moved.error.message);
    const [old] = await t.db.select().from(invitees).where(eq(invitees.id, b.inviteeId));
    expect(old).toMatchObject({ status: "canceled", newInviteeId: moved.data.inviteeId });
    const canceled = await actions.hostCancelMeetingAction({ scheduledEventId: moved.data.scheduledEventId, message: "Something urgent came up" });
    expect(canceled).toEqual({ ok: true, data: { canceledInviteeIds: [moved.data.inviteeId] } });
    const [m] = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, moved.data.scheduledEventId));
    expect(m).toMatchObject({ status: "canceled", cancelReason: "Something urgent came up" });
  });
});
