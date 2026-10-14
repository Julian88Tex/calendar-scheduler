// Cancel and reschedule page loaders on PGlite (SPEC CR-02, CR-03, CR-05, CR-08, SCH-23, SCH-24, BK-07, BK-08):
// unknown ids, the reschedule chain redirect, the meeting summary in the invitee's zone, each refusal state, the
// "Schedule another event" target, and the reschedule flow props (prefill, original duration, the slots flagged with
// the invitee, the deep link check that ignores the meeting being moved, the CR-08 rebook). lifecycle-core's contract
// is mocked: its real getInviteeChangeContext computes the data unless a test injects its own decision, so the pages
// are shown to follow lifecycle-core's rules rather than recompute them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WeeklyHours } from "@/db/types";
import type { InviteeChangeContext } from "@/lib/lifecycle";
import type { CreateEventTypeOptions, TestUser } from "../factories";

type ContextHook = (ctx: InviteeChangeContext | null) => InviteeChangeContext | null;

const state = vi.hoisted(() => ({ hook: null as ContextHook | null, calls: [] as string[], destination: null as unknown }));

vi.mock("@/lib/lifecycle", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/lifecycle")>();
  return {
    ...real,
    getInviteeChangeContext: async (id: string, opts?: { now?: Date }) => {
      state.calls.push(id);
      const ctx = await real.getInviteeChangeContext(id, opts);
      return state.hook ? state.hook(ctx) : ctx;
    },
  };
});
vi.mock("@/lib/calendars", () => ({
  getExternalBusy: async (p: { userIds: string[] }) => Object.fromEntries(p.userIds.map((id) => [id, { ok: true, stale: false, nocal: false, busy: [] }])),
  getDestinationCalendar: async () => state.destination,
}));
vi.mock("@/lib/links", () => ({
  resolveBookingCode: async () => null,
  consumeLinkInTx: async () => {},
  getReservedIntervals: async () => ({}),
  LinkUsedError: class LinkUsedError extends Error {},
}));
vi.mock("@/lib/polls", () => ({ getPollReservedIntervals: async () => ({}), markPollBookedInTx: async () => {} }));
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getCurrentUser: async () => null,
}));

const { eq } = await import("drizzle-orm");
const { eventTypeQuestions, eventTypes, scheduledEvents } = await import("@/db/schema");
const { loadChangePage } = await import("@/components/lifecycle/server/change-page");
const { loadReschedulePage } = await import("@/components/lifecycle/server/reschedule-page");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { at } = await import("@/lib/slots/testing");
const { useTestDb } = await import("../helpers/db");
const f = await import("../factories");
const messages = (await import("@/lib/i18n/messages/en/lifecycle")).default;

const t = useTestDb();
const LA = "America/Los_Angeles";
const NY = "America/New_York";
const la = (local: string) => new Date(at(local, LA));
const NOW = la("2030-10-07 06:00"); // Monday morning in Los Angeles
const r = (from: number, to: number) => [{ start: from * 60, end: to * 60 }];
const WEEKDAYS: WeeklyHours = [[], r(9, 17), r(9, 17), r(9, 17), r(9, 17), r(9, 17), []];
const MEET = { id: "5eed0000-0000-4000-8000-000000000301", kind: "google_conference" as const, position: 0 };
const CAFE = { id: "5eed0000-0000-4000-8000-000000000302", kind: "physical" as const, position: 1, location: "Blue Bottle", additionalInfo: "66 Mint St", displayBeforeBooking: true };
let seq = 0;

beforeEach(() => {
  setFakeNow(NOW);
  state.hook = null;
  state.calls = [];
  // A Google destination calendar: booking pages offer Google Meet next to the other locations (VID-07).
  state.destination = { calendarId: "c", connectionId: "k", provider: "google", name: "Work", supports: { invitations: true, googleMeet: true, teams: false } };
});
afterEach(() => resetFakeTime());

async function host() {
  const owner = await f.createUser(t.db, { name: "Ana Lima", email: `ana-${++seq}@example.com`, timezone: LA, slug: `ana-${seq}` });
  await f.createSchedule(t.db, { userId: owner.id, timezone: LA, weeklyHours: WEEKDAYS });
  return owner;
}

async function eventType(owner: TestUser, opts: Partial<CreateEventTypeOptions> = {}) {
  const { eventType } = await f.createEventType(t.db, {
    owner,
    name: "Intro Call",
    slug: "intro",
    durationMinutes: 30,
    locations: [MEET, CAFE],
    questions: [{ label: "What would you like to discuss?", type: "text", required: true }],
    ...opts,
    overrides: { slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, dateRangeType: "rolling", dateRangeDays: 60, ...opts.overrides },
  });
  return eventType;
}

async function booking(owner: TestUser, opts: { start?: Date; et?: Awaited<ReturnType<typeof eventType>>; invitee?: Parameters<typeof f.createBooking>[1]["invitee"]; overrides?: Parameters<typeof f.createBooking>[1]["overrides"]; durationMinutes?: number } = {}) {
  const et = opts.et ?? (await eventType(owner));
  const [question] = await t.db.select().from(eventTypeQuestions).where(eq(eventTypeQuestions.eventTypeId, et.id));
  const b = await f.createBooking(t.db, {
    eventType: et,
    start: opts.start ?? la("2030-10-08 10:00"),
    durationMinutes: opts.durationMinutes,
    invitee: {
      name: "Ben Ortiz",
      email: "ben@example.com",
      timezone: NY,
      questionsAndAnswers: question ? [{ questionId: question.id, question: question.label, type: question.type, position: 0, answer: "Roadmap review" }] : [],
      guests: ["guest1@example.com", "guest2@example.com"],
      overrides: { locationAnswer: { configId: CAFE.id, value: null } },
      ...opts.invitee,
    },
    overrides: opts.overrides,
  });
  return { et, ...b, invitee: b.invitee! };
}

describe("loadChangePage", () => {
  it("is not found for malformed and unknown invitee ids", async () => {
    expect(await loadChangePage("not-a-uuid", "cancel")).toEqual({ state: "not_found" });
    expect(await loadChangePage("4b0c9f3e-0000-4000-8000-000000000000", "reschedule")).toEqual({ state: "not_found" });
    // A malformed id never reaches lifecycle-core.
    expect(state.calls).toEqual(["4b0c9f3e-0000-4000-8000-000000000000"]);
  });

  it("shows the cancel form with the meeting in the invitee's zone, the guests and the booking page link", async () => {
    const owner = await host();
    const et = await eventType(owner, { overrides: { cancellationPolicy: "  Cancel 24 hours ahead.  ", requireCancelReason: true } });
    const b = await booking(owner, { et });
    const res = await loadChangePage(b.invitee.id, "cancel");
    if (res.state !== "ok") throw new Error(res.state);
    const v = res.view;
    expect(v.blocked).toBeNull();
    expect(v.inviteeId).toBe(b.invitee.id);
    expect(v.summary).toMatchObject({
      eventName: "Intro Call",
      hostName: "Ana Lima",
      durationMinutes: 30,
      zone: NY,
      zoneName: "Eastern Time - US & Canada",
      whenText: "1:00pm - 1:30pm, Tuesday, October 8, 2030",
      inviteeName: "Ben Ortiz",
      inviteeEmail: "ben@example.com",
      guestCount: 2,
      canceled: false,
      host: { variant: "single", person: { id: owner.id, name: "Ana Lima", avatarUrl: null } },
      brandHeader: { kind: "avatar", src: null, name: "Ana Lima" },
    });
    expect(v.requireReason).toBe(true);
    expect(v.cancellationPolicy).toBe("Cancel 24 hours ahead.");
    expect(v.scheduleAnotherHref).toBe(`/${owner.slug}/intro`);
    expect(v.shell).toMatchObject({ ribbon: true, privacyUrl: null });
  });

  it("redirects an old invitee of a reschedule chain to the active invitee (CR-02, CR-04)", async () => {
    const owner = await host();
    const current = await booking(owner, { start: la("2030-10-09 11:00") });
    const old = await booking(owner, {
      et: current.et,
      invitee: { status: "canceled", overrides: { rescheduled: true, newInviteeId: current.invitee.id, locationAnswer: null } },
      overrides: { status: "canceled" },
    });
    expect(await loadChangePage(old.invitee.id, "cancel")).toEqual({ state: "redirect", inviteeId: current.invitee.id });
    expect(await loadChangePage(old.invitee.id, "reschedule")).toEqual({ state: "redirect", inviteeId: current.invitee.id });
    const res = await loadChangePage(current.invitee.id, "cancel");
    expect(res.state).toBe("ok");
  });

  it("shows 'already canceled' and 'already occurred' (CR-02)", async () => {
    const owner = await host();
    const canceled = await booking(owner, { invitee: { status: "canceled" }, overrides: { status: "canceled" } });
    const c = await loadChangePage(canceled.invitee.id, "cancel");
    expect(c.state === "ok" && c.view.blocked).toMatchObject({ reason: "canceled", title: "This event has already been canceled." });
    expect(c.state === "ok" && c.view.summary.canceled).toBe(true);
    const past = await booking(owner, { et: canceled.et, start: la("2030-10-07 09:00") });
    setFakeNow(la("2030-10-07 09:05"));
    const p = await loadChangePage(past.invitee.id, "cancel");
    expect(p.state === "ok" && p.view.blocked).toMatchObject({ reason: "occurred", title: "This event has already occurred." });
    const pr = await loadChangePage(past.invitee.id, "reschedule");
    expect(pr.state === "ok" && pr.view.blocked).toMatchObject({ title: "This event can no longer be rescheduled.", body: "This event has already occurred.", cancelAvailable: false });
  });

  it("shows the SCH-23 cutoff message with the host's email inside the cutoff window", async () => {
    const owner = await host();
    const et = await eventType(owner, { overrides: { changeCutoffMinutes: 24 * 60 } });
    const b = await booking(owner, { et, start: la("2030-10-07 09:00") }); // 3 hours ahead
    const c = await loadChangePage(b.invitee.id, "cancel");
    expect(c.state === "ok" && c.view.blocked).toEqual({
      reason: "cutoff",
      title: "This meeting can no longer be changed online. Please contact Ana Lima.",
      body: null,
      contact: { name: "Ana Lima", email: owner.email },
      cancelAvailable: false,
    });
  });

  it("keeps canceling open when the event type is off, while rescheduling is refused (CR-02, CR-03)", async () => {
    const owner = await host();
    const b = await booking(owner);
    await t.db.update(eventTypes).set({ active: false }).where(eq(eventTypes.id, b.et.id));
    const c = await loadChangePage(b.invitee.id, "cancel");
    expect(c.state === "ok" && c.view.blocked).toBeNull();
    // The booking page is off: "Schedule another event" opens the host's landing page.
    expect(c.state === "ok" && c.view.scheduleAnotherHref).toBe(`/${owner.slug}`);
    const rr = await loadReschedulePage({ inviteeId: b.invitee.id, mode: "calendar", searchParams: {} });
    expect(rr.state).toBe("blocked");
    expect(rr.state === "blocked" && rr.view.blocked).toMatchObject({ reason: "not_reschedulable", title: messages.changes.notReschedulable, cancelAvailable: true });
  });

  it("follows lifecycle-core's decision instead of recomputing the rules", async () => {
    const owner = await host();
    const b = await booking(owner);
    state.hook = (ctx) => (ctx ? { ...ctx, rescheduleBlock: { reason: "not_reschedulable", message: messages.changes.notReschedulable } } : ctx);
    const rr = await loadReschedulePage({ inviteeId: b.invitee.id, mode: "calendar", searchParams: {} });
    expect(rr.state).toBe("blocked");
    state.hook = (ctx) => (ctx ? { ...ctx, cancelBlock: { reason: "canceled", message: messages.changes.canceled } } : ctx);
    const c = await loadChangePage(b.invitee.id, "cancel");
    expect(c.state === "ok" && c.view.blocked?.title).toBe("This event has already been canceled.");
  });
});

describe("loadReschedulePage", () => {
  it("builds the flow with the former time, the prefilled form and the original duration (CR-03, BK-07)", async () => {
    const owner = await host();
    const et = await eventType(owner, { overrides: { durationOptions: [30, 60] } });
    const b = await booking(owner, { et, durationMinutes: 60 });
    const res = await loadReschedulePage({ inviteeId: b.invitee.id, mode: "calendar", searchParams: { month: "2030-10" } });
    if (res.state !== "flow") throw new Error(res.state);
    const flow = res.flow;
    expect(flow.basePath).toBe(`/reschedulings/${b.invitee.id}`);
    expect(flow.cancelPath).toBe(`/cancellations/${b.invitee.id}`);
    expect(flow.rescheduleTarget).toBe(b.invitee.id);
    expect(flow.rebook).toBe(false);
    expect(flow.slotsTarget).toBe(et.id);
    expect(flow.former).toEqual({ start: la("2030-10-08 10:00").toISOString(), end: la("2030-10-08 11:00").toISOString() });
    expect(flow.originalDuration).toBe(60);
    expect(flow.initial).toEqual({ mode: "calendar", month: "2030-10", date: null, start: null, startAvailable: null, duration: 60 });
    expect(flow.event.durations).toEqual([30, 60]);
    expect(flow.values).toMatchObject({ name: "Ben Ortiz", email: "ben@example.com", guests: ["guest1@example.com", "guest2@example.com"], showGuests: true, locationId: CAFE.id });
    expect(Object.values(flow.values.answers)).toEqual(["Roadmap review"]);
    expect(flow.inviteeZone).toBe(NY);
    expect(flow.hostName).toBe("Ana Lima");
  });

  it("checks a deep linked start with the moved meeting ignored (SCH-24, BK-08)", async () => {
    const owner = await host();
    const b = await booking(owner);
    await booking(owner, { et: b.et, start: la("2030-10-08 11:00"), invitee: { name: "Other", email: "other@example.com", guests: [] } });
    const own = await loadReschedulePage({ inviteeId: b.invitee.id, mode: "details", start: la("2030-10-08 10:00"), searchParams: {} });
    expect(own.state === "flow" && own.flow.initial).toMatchObject({ mode: "details", startAvailable: true, start: la("2030-10-08 10:00").toISOString() });
    const taken = await loadReschedulePage({ inviteeId: b.invitee.id, mode: "details", start: la("2030-10-08 11:00"), searchParams: {} });
    expect(taken.state === "flow" && taken.flow.initial).toMatchObject({ mode: "details", startAvailable: false });
  });

  it("opens a rebook after 'Share new times to meet' without the slots exclusion (CR-08)", async () => {
    const owner = await host();
    const b = await booking(owner, {
      invitee: { status: "canceled", overrides: { locationAnswer: { configId: MEET.id, value: null }, metadata: { lifecycle: { cancelKind: "request_reschedule", requestReschedule: { requestedAt: NOW.toISOString(), message: null, reminderDays: null, byUserId: null } } } } },
      overrides: { status: "canceled" },
    });
    await t.db.update(scheduledEvents).set({ status: "canceled" }).where(eq(scheduledEvents.id, b.scheduledEvent.id));
    const c = await loadChangePage(b.invitee.id, "cancel");
    expect(c.state === "ok" && c.view.blocked?.reason).toBe("canceled");
    const res = await loadReschedulePage({ inviteeId: b.invitee.id, mode: "calendar", searchParams: {} });
    if (res.state !== "flow") throw new Error(res.state);
    expect(res.flow.rebook).toBe(true);
    expect(res.flow.rescheduleTarget).toBeNull();
    expect(res.flow.cancelPath).toBeNull();
    expect(res.flow.values.locationId).toBe(MEET.id);
    // Without a Google calendar the Meet option is not offered any more: no original choice to keep (CR-03).
    state.destination = null;
    const noMeet = await loadReschedulePage({ inviteeId: b.invitee.id, mode: "calendar", searchParams: {} });
    expect(noMeet.state === "flow" && noMeet.flow.event.locations.map((l) => l.kind)).toEqual(["physical"]);
    expect(noMeet.state === "flow" && noMeet.flow.values.locationId).toBeNull();
    // Guests canceled with the meeting are invited again.
    expect(res.flow.values.guests).toEqual(["guest1@example.com", "guest2@example.com"]);
  });
});

describe("loadHostMeetingSummary", () => {
  it("gives the host dialogs their meeting and hides other tenants' meetings", async () => {
    const { loadHostMeetingSummary } = await import("@/components/lifecycle/server/host-meeting");
    const { loadActorCtx } = await import("@/lib/authz");
    const { inviteeNoShows, users } = await import("@/db/schema");
    const owner = await host();
    const b = await booking(owner);
    await t.db.insert(inviteeNoShows).values({ inviteeId: b.invitee.id, createdByUserId: owner.id });
    const [ownerRow] = await t.db.select().from(users).where(eq(users.id, owner.id));
    const summary = await loadHostMeetingSummary(await loadActorCtx(t.db, ownerRow!), b.scheduledEvent.id);
    expect(summary).toMatchObject({
      scheduledEventId: b.scheduledEvent.id,
      eventName: "Intro Call",
      status: "active",
      source: "booking_page",
      eventTypeBookable: true,
      hostCount: 1,
      timeZone: LA,
      hour12: true,
      durationMinutes: 30,
      invitees: [{ id: b.invitee.id, name: "Ben Ortiz", email: "ben@example.com", timezone: NY, status: "active", noShow: true }],
      notesHtml: null,
    });
    const stranger = await host();
    const [strangerRow] = await t.db.select().from(users).where(eq(users.id, stranger.id));
    expect(await loadHostMeetingSummary(await loadActorCtx(t.db, strangerRow!), b.scheduledEvent.id)).toBeNull();
    expect(await loadHostMeetingSummary(await loadActorCtx(t.db, ownerRow!), "nope")).toBeNull();
  });
});
