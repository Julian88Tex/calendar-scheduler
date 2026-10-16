// Regressions from the adversarial review of lifecycle-core (PGlite, real booking service, fake calendar provider,
// real workflows subscriber):
// - guests never receive the invitee's Cancel and Reschedule capability links, not even inside invite.ics (NT-01);
//   guests dropped in a reschedule get a CANCEL for the former event (NT-04, NT-06);
// - a whole-meeting cancel of a group slot sends its host email even when a seat was canceled before (NT-03);
// - in-place moves publish booking.rescheduled (same invitee on both sides), so workflow reminders follow the new
//   time, while this module sends a single update (MP-21, docs/SCOPE.md priority 5);
// - reschedules start from the original duration only while the event type still offers it (CR-03, BK-07);
// - "Share new times to meet" is refused while the event type is off (CR-08);
// - the cancel and reschedule page read model shows the invitee's own seat only and no host notes (CR-14, GEN-08);
// - after a move made in the connected calendar, the next provisioning run does not rewrite the provider event
//   (CR-17: Google would mail every attendee an "updated invitation" for nothing).
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/calendars/credentials", () => ({
  withConnection: async (connectionId: string, fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ connectionId, userId: "", provider: "google", accessToken: "fake-access", unavailableStatuses: [] }),
  encryptedTokenColumns: async () => ({}),
}));
vi.mock("@/lib/calendars/providers/registry", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/calendars/providers/registry")>();
  const { fakeCalendarProvider } = await import("../helpers/fake-providers");
  return { ...real, getProvider: (id: "google") => fakeCalendarProvider(id) };
});
vi.mock("@/lib/links", () => ({
  resolveBookingCode: async () => null,
  consumeLinkInTx: async () => {},
  getReservedIntervals: async () => ({}),
  LinkUsedError: class LinkUsedError extends Error {},
}));
vi.mock("@/lib/polls", () => ({ getPollReservedIntervals: async () => ({}), markPollBookedInTx: async () => {} }));
vi.mock("@/lib/events/registry", async () => {
  const { lifecycleSubscribers } = await import("@/lib/lifecycle/subscriber-handlers");
  const { workflowSubscribers } = await import("@/lib/workflows/subscriber-handlers");
  const maps: Record<string, Record<string, unknown>> = {
    lifecycle: lifecycleSubscribers as Record<string, unknown>,
    workflows: workflowSubscribers as Record<string, unknown>,
  };
  return {
    SUBSCRIBER_KEYS: Object.keys(maps),
    isSubscriberKey: (k: string) => k in maps,
    subscriberKeysFor: (type: string) => Object.keys(maps).filter((k) => typeof maps[k]![type] === "function"),
    getSubscriber: (key: string, type: string) => maps[key]?.[type] ?? null,
  };
});
vi.mock("@/lib/lifecycle/jobs", async () => ({ handlers: (await import("@/lib/lifecycle/job-handlers")).lifecycleJobHandlers, periodic: [] }));

const { domainEvents, eventTypes, scheduledEvents, workflowExecutions } = await import("@/db/schema");
const { setFakeNow, resetFakeTime } = await import("@/lib/time/now");
const { loadActorCtx } = await import("@/lib/authz");
const { runDueJobs } = await import("@/lib/jobs");
const { setEventTypeRemindersEnabled } = await import("@/lib/workflows/reminders");
const { fakeCalendarProvider, resetFakeProviders } = await import("../helpers/fake-providers");
const { useTestDb } = await import("../helpers/db");
const { cancelInvitee, cancelScheduledEvent } = await import("@/lib/lifecycle/cancel");
const { moveScheduledEvent, requestReschedule, rescheduleInvitee } = await import("@/lib/lifecycle/reschedule");
const { getInviteeChangeContext } = await import("@/lib/lifecycle/queries");
const { applyExternalCalendarChange } = await import("@/lib/lifecycle/external");
const { provisionMeeting } = await import("@/lib/lifecycle/provision");
const h = await import("./helpers");
const { CAFE, DAY, HOUR, MIN, NOW, book, drain, icsProps, invitee, la, linkedRows, meeting, outbox, setupHost } = h;

const t = useTestDb();
const provider = () => fakeCalendarProvider("google");
const calls = (method: string) => provider().calls.filter((c) => c.method === method);
const invite = { type: "invitee" } as const;
/** ICS text with RFC 5545 line folding undone (a folded URL would hide from toContain). */
const unfold = (ics: string | null | undefined) => (ics ?? "").replace(/\r?\n[ \t]/g, "");

beforeEach(() => {
  resetFakeProviders();
  setFakeNow(NOW);
});
afterEach(() => resetFakeTime());

async function hostActor(owner: Parameters<typeof loadActorCtx>[1]) {
  return { type: "user" as const, ctx: await loadActorCtx(t.db, owner) };
}

/** Runs the lifecycle jobs and the workflows subscriber jobs. */
async function drainAll(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const r = await runDueJobs({
      budgetMs: 20_000,
      types: ["event:booking.created:workflows", "event:booking.rescheduled:workflows", "event:booking.canceled:workflows"],
      workerId: "test",
    });
    if (r.ran === 0) break;
  }
  await drain(t.db);
}

describe("guests and capability links (NT-01, NT-04, NT-06)", () => {
  it("guest confirmations carry an invite without the invitee's Cancel and Reschedule links", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const r = await book(fx, la("2030-10-08 10:00"), {
      guests: ["guest.rv@example.com"],
      invitee: { name: "Ana Lima", email: "ana.rv1@example.com", timezone: "Europe/Berlin" },
    });
    await drain(t.db);
    const [own] = await outbox(t.db, { to: "ana.rv1@example.com", template: "lifecycle.invitee_confirmation" });
    const [guest] = await outbox(t.db, { to: "guest.rv@example.com", template: "lifecycle.guest_confirmation" });
    expect(unfold(own!.ics)).toContain(`/cancellations/${r.inviteeId}`);
    expect(guest!.icsMethod).toBe("REQUEST");
    expect(icsProps(guest!.ics).UID).toBe(icsProps(own!.ics).UID);
    for (const part of [guest!.text, guest!.html, unfold(guest!.ics)]) {
      expect(part).not.toContain("/cancellations/");
      expect(part).not.toContain("/reschedulings/");
    }
  });

  it("a reschedule sends guests a link-free update and cancels the former event for guests who were dropped", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const r = await book(fx, la("2030-10-08 10:00"), {
      guests: ["stays.rv@example.com", "dropped.rv@example.com"],
      invitee: { name: "Ana Lima", email: "ana.rv2@example.com", timezone: "Europe/Berlin" },
    });
    await drain(t.db);
    const first = await meeting(t.db, r.scheduledEventId);
    const res = await rescheduleInvitee({ inviteeId: r.inviteeId, start: la("2030-10-09 11:00").toISOString(), actor: invite, guests: ["stays.rv@example.com"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await drain(t.db);
    const [update] = await outbox(t.db, { to: "stays.rv@example.com", template: "lifecycle.guest_rescheduled" });
    expect(unfold(update!.ics)).not.toContain("/cancellations/");
    expect(unfold(update!.ics)).not.toContain("/reschedulings/");
    expect(icsProps(update!.ics)).toMatchObject({ UID: first.icsUid, SEQUENCE: "1" });
    expect(await outbox(t.db, { to: "dropped.rv@example.com", template: "lifecycle.guest_rescheduled" })).toHaveLength(0);
    const [canceled] = await outbox(t.db, { to: "dropped.rv@example.com", template: "lifecycle.guest_canceled" });
    expect(canceled!.icsMethod).toBe("CANCEL");
    expect(icsProps(canceled!.ics)).toMatchObject({ UID: first.icsUid, STATUS: "CANCELLED" });
    expect(canceled!.text).not.toContain("/reschedulings/");
    // The invitee's own update still has their links.
    const [mine] = await outbox(t.db, { to: "ana.rv2@example.com", template: "lifecycle.invitee_rescheduled" });
    expect(unfold(mine!.ics)).toContain(`/cancellations/${res.inviteeId}`);
  });
});

describe("group slot host emails (NT-03, CR-06)", () => {
  it("a whole-meeting cancel after an earlier seat cancellation still emails the host once, naming the remaining invitees", async () => {
    const fx = await setupHost(t.db, { kind: "group", maxInvitees: 3, locations: [CAFE] });
    const start = la("2030-10-09 10:00");
    const seats: Awaited<ReturnType<typeof book>>[] = [];
    for (const n of ["Ada", "Bea", "Cy"]) seats.push(await book(fx, start, { invitee: { name: n, email: `${n.toLowerCase()}.rv@example.com`, timezone: "UTC" } }));
    await drain(t.db);
    await cancelInvitee({ inviteeId: seats[0]!.inviteeId, actor: invite, reason: "Can't make it" });
    await drain(t.db);
    const id = seats[0]!.scheduledEventId;
    const [seatMail] = await outbox(t.db, { to: fx.owner.email, template: "lifecycle.host_canceled", scheduledEventId: id });
    // The host has no calendar, so their copy of the slot came as a file: one seat leaving must not cancel it.
    expect(seatMail!.ics).toBeNull();
    expect((await outbox(t.db, { to: fx.owner.email, template: "lifecycle.host_new_event", scheduledEventId: id }))[0]!.icsMethod).toBe("REQUEST");
    await cancelScheduledEvent({ scheduledEventId: id, actor: await hostActor(fx.owner), reason: "Workshop moved online" });
    await drain(t.db);
    const hostMails = await outbox(t.db, { to: fx.owner.email, template: "lifecycle.host_canceled", scheduledEventId: id });
    expect(hostMails).toHaveLength(2);
    const whole = hostMails[1]!;
    expect(whole.text).toContain("Bea");
    expect(whole.text).toContain("Cy");
    expect(whole.text).not.toContain("ada.rv@example.com");
    expect(whole.text).toContain("Workshop moved online");
    expect(whole.icsMethod).toBe("CANCEL");
    for (const n of ["bea", "cy"]) expect(await outbox(t.db, { to: `${n}.rv@example.com`, template: "lifecycle.invitee_canceled" })).toHaveLength(1);
  });
});

describe("in-place moves and reminders (MP-21, NT-15)", () => {
  it("moveScheduledEvent re-times the invitee's reminder and sends one update", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const actor = await hostActor(fx.owner);
    await setEventTypeRemindersEnabled(actor.ctx, { eventTypeId: fx.eventTypeId, kind: "invitee", enabled: true }, t.db);
    const start = la("2030-10-10 10:00");
    const r = await book(fx, start, { invitee: { name: "Ana Lima", email: "ana.rv3@example.com", timezone: "UTC" } });
    await drainAll();
    const reminder = async () =>
      (await t.db.select().from(workflowExecutions).where(and(eq(workflowExecutions.inviteeId, r.inviteeId), eq(workflowExecutions.trigger, "before_start"))))[0]!;
    expect((await reminder()).runAt.getTime()).toBe(start.getTime() - DAY);

    const next = la("2030-10-11 13:00");
    await moveScheduledEvent({ scheduledEventId: r.scheduledEventId, start: next, end: new Date(next.getTime() + 30 * MIN), actor });
    const events = (await t.db.select().from(domainEvents).where(eq(domainEvents.type, "booking.rescheduled"))).filter(
      (e) => (e.payload as { newScheduledEventId: string }).newScheduledEventId === r.scheduledEventId,
    );
    expect(events.map((e) => e.payload)).toEqual([
      { oldInviteeId: r.inviteeId, newInviteeId: r.inviteeId, oldScheduledEventId: r.scheduledEventId, newScheduledEventId: r.scheduledEventId, reason: null },
    ]);
    await drainAll();
    const moved = await reminder();
    expect(moved.status).toBe("scheduled");
    expect(moved.runAt.getTime()).toBe(next.getTime() - DAY);
    expect(await outbox(t.db, { to: "ana.rv3@example.com", template: "lifecycle.invitee_rescheduled" })).toHaveLength(1);
    expect(await outbox(t.db, { to: "ana.rv3@example.com", template: "lifecycle.invitee_confirmation" })).toHaveLength(1);
    expect(await outbox(t.db, { to: fx.owner.email, template: "lifecycle.host_rescheduled" })).toHaveLength(1);
  });
});

describe("reschedule duration (CR-03, BK-07)", () => {
  it("starts from the original duration while it is offered, else the default; hosts keep the meeting's length", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const a = await book(fx, la("2030-10-08 10:00"));
    const b = await book(fx, la("2030-10-08 12:00"));
    // The owner turns the 30 minute event into a 60 minute one after these bookings.
    await t.db.update(eventTypes).set({ durationMinutes: 60, durationOptions: null }).where(eq(eventTypes.id, fx.eventTypeId));
    const mine = await rescheduleInvitee({ inviteeId: a.inviteeId, start: la("2030-10-09 10:00").toISOString(), actor: invite });
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
    expect((await meeting(t.db, mine.scheduledEventId)).durationMinutes).toBe(60);
    const byHost = await rescheduleInvitee({ inviteeId: b.inviteeId, start: la("2030-10-09 14:00").toISOString(), actor: await hostActor(fx.owner) });
    expect(byHost.ok).toBe(true);
    if (!byHost.ok) return;
    const moved = await meeting(t.db, byHost.scheduledEventId);
    expect(moved.durationMinutes).toBe(30);
    expect(moved.endAt.getTime() - moved.startAt.getTime()).toBe(30 * MIN);
  });
});

describe("Share new times to meet (CR-08)", () => {
  it("is refused while the event type is off, and the meeting stays booked", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const r = await book(fx, la("2030-10-08 10:00"));
    await t.db.update(eventTypes).set({ active: false }).where(eq(eventTypes.id, fx.eventTypeId));
    await expect(requestReschedule({ inviteeId: r.inviteeId, actor: await hostActor(fx.owner), message: "New time?" })).rejects.toMatchObject({
      code: "validation",
      message: "Your invitee can't pick a new time while this event type is off or deleted. Cancel the meeting instead.",
    });
    expect((await invitee(t.db, r.inviteeId)).status).toBe("active");
    await expect(requestReschedule({ inviteeId: r.inviteeId, actor: await hostActor(fx.owner), reminderDays: 2 as 1 })).rejects.toMatchObject({ code: "validation" });
  });
});

describe("cancel and reschedule page read model (CR-02, CR-14)", () => {
  it("shows the invitee's own seat, never other invitees or the host's notes", async () => {
    const fx = await setupHost(t.db, { kind: "group", maxInvitees: 3, locations: [CAFE] });
    const start = la("2030-10-09 10:00");
    const a = await book(fx, start, { invitee: { name: "Ada", email: "ada.ctx@example.com", timezone: "UTC" } });
    await book(fx, start, { invitee: { name: "Bea", email: "bea.ctx@example.com", timezone: "UTC" } });
    await t.db.update(scheduledEvents).set({ meetingNotesHtml: "<p>Private</p>", meetingNotesPlain: "Private" }).where(eq(scheduledEvents.id, a.scheduledEventId));
    const ctx = await getInviteeChangeContext(a.inviteeId);
    expect(ctx).not.toBeNull();
    expect(ctx!.meeting.invitees.map((i) => i.email)).toEqual(["ada.ctx@example.com"]);
    expect(ctx!.meeting.meeting.meetingNotesHtml).toBeNull();
    expect(ctx!.meeting.meeting.meetingNotesPlain).toBeNull();
    expect(JSON.stringify(ctx)).not.toContain("bea.");
    expect(ctx!.cancelBlock).toBeNull();
  });
});

describe("moves made in the connected calendar (CR-17, CAL-14)", () => {
  it("a later provisioning run does not rewrite the provider event that already shows the move", async () => {
    const fx = await setupHost(t.db, { google: true });
    const r = await book(fx, la("2030-10-09 10:00"), { invitee: { name: "Ana Lima", email: "ana.rv4@example.com", timezone: "Europe/Berlin" } });
    await drain(t.db);
    const row = (await linkedRows(t.db, r.scheduledEventId)).find((x) => x.purpose === "meeting")!;
    const old = await meeting(t.db, r.scheduledEventId);
    const list = provider().events.get(`${fx.connectionId}:${fx.owner.email}`) ?? [];
    const ev = list.find((e) => e.externalId === row.externalId)!;
    ev.start = new Date(old.startAt.getTime() + HOUR);
    ev.end = new Date(old.endAt.getTime() + HOUR);
    await applyExternalCalendarChange({ linkedEventId: row.id, change: { type: "moved", start: ev.start, end: ev.end } });
    await drain(t.db);
    const [moved] = await t.db.select().from(scheduledEvents).where(and(eq(scheduledEvents.rescheduledFromEventId, old.id), eq(scheduledEvents.status, "active")));
    expect(moved).toBeDefined();
    expect(calls("updateEvent")).toHaveLength(0);
    const out = await provisionMeeting(t.db, moved!.id);
    expect(out.calendar).toBe("unchanged");
    expect(calls("updateEvent")).toHaveLength(0);
    expect(calls("createEvent")).toHaveLength(1);
  });
});
