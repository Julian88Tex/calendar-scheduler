// Cancel, reschedule and move on PGlite with the real booking service and the fake calendar provider (SPEC CR-02,
// CR-03, CR-04, CR-06, CR-07, CR-16, NT-03, NT-04, NT-06, SCH-23, MP-21): data model links, emails and ICS sequences,
// calendar delete or move, refusals with the Calendly copy, the event type off rule, host override, in-place moves.
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
  const map = lifecycleSubscribers as Record<string, unknown>;
  return {
    SUBSCRIBER_KEYS: ["lifecycle"],
    isSubscriberKey: (k: string) => k === "lifecycle",
    subscriberKeysFor: (type: string) => (typeof map[type] === "function" ? ["lifecycle"] : []),
    getSubscriber: (key: string, type: string) => (key === "lifecycle" ? (map[type] ?? null) : null),
  };
});
vi.mock("@/lib/lifecycle/jobs", async () => ({ handlers: (await import("@/lib/lifecycle/job-handlers")).lifecycleJobHandlers, periodic: [] }));

const { domainEvents, eventTypes, inviteeGuests, scheduledEventHosts } = await import("@/db/schema");
const { setFakeNow, resetFakeTime } = await import("@/lib/time/now");
const { loadActorCtx } = await import("@/lib/authz");
const { getAvailability } = await import("@/lib/booking/availability");
const { loadEventType } = await import("@/lib/booking/target");
const { fakeCalendarProvider, resetFakeProviders } = await import("../helpers/fake-providers");
const { useTestDb } = await import("../helpers/db");
const { cancelInvitee, cancelScheduledEvent } = await import("@/lib/lifecycle/cancel");
const { rescheduleInvitee, moveScheduledEvent } = await import("@/lib/lifecycle/reschedule");
const { resolveActiveInviteeChain } = await import("@/lib/lifecycle/chain");
const h = await import("./helpers");
const { CAFE, HOUR, NOW, book, drain, icsProps, invitee, la, linkedRows, meeting, outbox, setupHost } = h;

const t = useTestDb();
const provider = () => fakeCalendarProvider("google");
const calls = (method: string) => provider().calls.filter((c) => c.method === method);
const invite = { type: "invitee" } as const;

beforeEach(() => {
  resetFakeProviders();
  setFakeNow(NOW);
});
afterEach(() => resetFakeTime());

async function hostActor(fx: { owner: Parameters<typeof loadActorCtx>[1] }) {
  return { type: "user" as const, ctx: await loadActorCtx(t.db, fx.owner) };
}

describe("cancel (CR-02, CR-06, CR-16, NT-03)", () => {
  it("invitee cancel: data model, booking.canceled, one invitee and one host email with ICS CANCEL", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const r = await book(fx, la("2030-10-08 10:00"), { guests: ["guest@example.com"], invitee: { name: "Ana Lima", email: "ana.c1@example.com", timezone: "Europe/Berlin" } });
    await drain(t.db);
    const out = await cancelInvitee({ inviteeId: r.inviteeId, actor: invite, reason: "Something came up" });
    expect(out).toEqual({ inviteeId: r.inviteeId, scheduledEventId: r.scheduledEventId, meetingCanceled: true });
    const inv = await invitee(t.db, r.inviteeId);
    expect(inv.status).toBe("canceled");
    expect(inv.cancelerType).toBe("invitee");
    expect(inv.cancelReason).toBe("Something came up");
    expect(inv.canceledAt).not.toBeNull();
    const m = await meeting(t.db, r.scheduledEventId);
    expect(m.status).toBe("canceled");
    expect(m.icsSequence).toBe(1);
    const hosts = await t.db.select().from(scheduledEventHosts).where(eq(scheduledEventHosts.scheduledEventId, m.id));
    expect(hosts.every((x) => !x.isActive)).toBe(true);
    const [guest] = await t.db.select().from(inviteeGuests).where(eq(inviteeGuests.inviteeId, r.inviteeId));
    expect(guest!.canceledAt).not.toBeNull();
    const [ev] = await t.db.select().from(domainEvents).where(and(eq(domainEvents.type, "booking.canceled")));
    expect(ev!.payload).toMatchObject({ scheduledEventId: m.id, inviteeId: r.inviteeId, cancelerType: "invitee", meetingCanceled: true, reason: "Something came up" });

    await drain(t.db);
    const inviteeMails = await outbox(t.db, { to: "ana.c1@example.com", template: "lifecycle.invitee_canceled", scheduledEventId: m.id });
    expect(inviteeMails).toHaveLength(1);
    expect(inviteeMails[0]!.text).toContain("Something came up");
    expect(inviteeMails[0]!.text).toContain("Schedule again");
    expect(inviteeMails[0]!.icsMethod).toBe("CANCEL");
    const ics = icsProps(inviteeMails[0]!.ics);
    expect(ics.UID).toBe(m.icsUid);
    expect(ics.SEQUENCE).toBe("1");
    expect(ics.STATUS).toBe("CANCELLED");
    expect(await outbox(t.db, { to: fx.owner.email, template: "lifecycle.host_canceled", scheduledEventId: m.id })).toHaveLength(1);
    expect(await outbox(t.db, { to: "guest@example.com", template: "lifecycle.guest_canceled", scheduledEventId: m.id })).toHaveLength(1);

    // The slot is free again.
    const target = { kind: "event_type" as const, eventType: (await loadEventType(fx.eventTypeId, t.db))! };
    const avail = await getAvailability({ target, start: la("2030-10-08 00:00"), end: la("2030-10-09 00:00"), now: NOW });
    expect(avail.slots.some((s) => s.start === la("2030-10-08 10:00").getTime())).toBe(true);

    await expect(cancelInvitee({ inviteeId: r.inviteeId, actor: invite })).rejects.toMatchObject({ code: "conflict", message: "This event has already been canceled." });
  });

  it("calendar invitation mode: one provider delete with notifications, a cancellation email without ICS", async () => {
    const fx = await setupHost(t.db, { google: true });
    const r = await book(fx, la("2030-10-08 11:00"), { invitee: { name: "Ana Lima", email: "ana.c2@example.com", timezone: "Europe/Berlin" } });
    await drain(t.db);
    const actor = await hostActor(fx);
    const out = await cancelScheduledEvent({ scheduledEventId: r.scheduledEventId, actor, reason: "I'm out sick" });
    expect(out.canceledInviteeIds).toEqual([r.inviteeId]);
    await drain(t.db);
    const deletes = calls("deleteEvent");
    expect(deletes).toHaveLength(1);
    expect((deletes[0]!.args[2] as { notifyAttendees: boolean }).notifyAttendees).toBe(true);
    const [mail] = await outbox(t.db, { to: "ana.c2@example.com", template: "lifecycle.invitee_canceled", scheduledEventId: r.scheduledEventId });
    expect(mail!.ics).toBeNull();
    expect(mail!.text).toContain("I'm out sick");
    expect(mail!.text).toContain("Julian Joseph"); // canceled by
    const inv = await invitee(t.db, r.inviteeId);
    expect(inv.cancelerType).toBe("host");
    expect(inv.canceledByUserId).toBe(fx.owner.id);
    expect((await linkedRows(t.db, r.scheduledEventId)).every((x) => x.status === "deleted")).toBe(true);
  });

  it("refuses invitee cancels after the start and inside the cutoff, requires a reason when asked (SCH-23, CR-02)", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE], eventType: { changeCutoffMinutes: 24 * 60, requireCancelReason: true } });
    const soon = await book(fx, new Date(NOW.getTime() + 3 * HOUR));
    await expect(cancelInvitee({ inviteeId: soon.inviteeId, actor: invite, reason: "x" })).rejects.toMatchObject({
      code: "conflict",
      message: "This meeting can no longer be changed online. Please contact Julian Joseph.",
    });
    // Hosts are never limited by the cutoff.
    const actor = await hostActor(fx);
    await expect(cancelInvitee({ inviteeId: soon.inviteeId, actor })).resolves.toMatchObject({ meetingCanceled: true });

    const later = await book(fx, la("2030-10-12 10:00"));
    await expect(cancelInvitee({ inviteeId: later.inviteeId, actor: invite, reason: "  " })).rejects.toMatchObject({ code: "validation", message: "Please share a reason for canceling." });
    setFakeNow(la("2030-10-12 10:05"));
    await expect(cancelInvitee({ inviteeId: later.inviteeId, actor: invite, reason: "late" })).rejects.toMatchObject({ code: "conflict", message: "This event has already occurred." });
    await expect(cancelInvitee({ inviteeId: "not-a-uuid", actor: invite })).rejects.toMatchObject({ code: "not_found" });
  });

  it("cancel still works when the event type is off or deleted", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const r = await book(fx, la("2030-10-09 10:00"));
    await t.db.update(eventTypes).set({ active: false, deletedAt: NOW }).where(eq(eventTypes.id, fx.eventTypeId));
    await expect(cancelInvitee({ inviteeId: r.inviteeId, actor: invite })).resolves.toMatchObject({ meetingCanceled: true });
  });
});

describe("cancel and reschedule links (CR-01)", () => {
  it("with links off, no invitee email contains /cancellations/ and the calendar description has none", async () => {
    const fx = await setupHost(t.db, { google: true, eventType: { includeCancelRescheduleLinks: false, notificationType: "email_confirmation" } });
    const r = await book(fx, la("2030-10-11 10:00"), { invitee: { name: "Ana Lima", email: "ana.l0@example.com", timezone: "UTC" } });
    await drain(t.db);
    await cancelInvitee({ inviteeId: r.inviteeId, actor: invite });
    await drain(t.db);
    const mails = await outbox(t.db, { to: "ana.l0@example.com", scheduledEventId: r.scheduledEventId });
    expect(mails.map((m) => m.template).sort()).toEqual(["lifecycle.invitee_canceled", "lifecycle.invitee_confirmation"]);
    for (const m of mails) {
      expect(m.text + m.html + (m.ics ?? "")).not.toContain("/cancellations/");
      expect(m.text).not.toContain("Schedule again");
    }
    const created = calls("createEvent")[0]!.args[1] as { descriptionText: string };
    expect(created.descriptionText).not.toContain("/cancellations/");
  });
});

describe("reschedule (CR-03, CR-04, NT-04)", () => {
  it("links the invitees, keeps the UID with SEQUENCE 1 and emails the update (email confirmation mode)", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const r = await book(fx, la("2030-10-08 10:00"), { guests: ["g2@example.com"], invitee: { name: "Ana Lima", email: "ana.r1@example.com", timezone: "Europe/Berlin", timeFormat: "24h" } });
    await drain(t.db);
    const first = await meeting(t.db, r.scheduledEventId);
    const res = await rescheduleInvitee({ inviteeId: r.inviteeId, start: la("2030-10-09 14:00").toISOString(), reason: "Conflict", actor: invite });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const old = await invitee(t.db, r.inviteeId);
    const next = await invitee(t.db, res.inviteeId);
    expect(old).toMatchObject({ status: "canceled", rescheduled: true, newInviteeId: res.inviteeId, cancelerType: "invitee", rescheduleReason: "Conflict" });
    expect(next).toMatchObject({ status: "active", oldInviteeId: r.inviteeId, email: "ana.r1@example.com", timeFormat: "24h", timezone: "Europe/Berlin" });
    expect(next.questionsAndAnswers[0]!.answer).toBe("The roadmap"); // prefilled
    const m = await meeting(t.db, res.scheduledEventId);
    expect(m.icsUid).toBe(first.icsUid);
    expect(m.icsSequence).toBe(1);
    expect((await meeting(t.db, r.scheduledEventId)).status).toBe("canceled");
    expect((await resolveActiveInviteeChain(r.inviteeId))!.id).toBe(res.inviteeId);

    await drain(t.db);
    const [mail] = await outbox(t.db, { to: "ana.r1@example.com", template: "lifecycle.invitee_rescheduled" });
    expect(mail!.subject).toBe("Updated: 30 Minute Virtual with Julian Joseph on Wednesday, October 9, 2030");
    expect(mail!.text).toContain("23:00 - Wednesday, October 9, 2030 (Central European Time)");
    expect(mail!.text).toContain("19:00 - Tuesday, October 8, 2030 (Central European Time)"); // former time
    expect(mail!.text).toContain("Conflict");
    expect(mail!.text).toContain(`/reschedulings/${res.inviteeId}`);
    const ics = icsProps(mail!.ics);
    expect(mail!.icsMethod).toBe("REQUEST");
    expect(ics.UID).toBe(first.icsUid);
    expect(ics.SEQUENCE).toBe("1");
    const [guest] = await outbox(t.db, { to: "g2@example.com", template: "lifecycle.guest_rescheduled" });
    expect(guest!.text).not.toContain("/reschedulings/");
    const [host] = await outbox(t.db, { to: fx.owner.email, template: "lifecycle.host_rescheduled", scheduledEventId: m.id });
    expect(host!.subject).toBe("Rescheduled: Ana Lima - 2:00pm Wednesday, October 9, 2030 - 30 Minute Virtual");
    // No cancellation or confirmation email for a reschedule.
    expect(await outbox(t.db, { to: "ana.r1@example.com", template: "lifecycle.invitee_canceled" })).toHaveLength(0);
    expect(await outbox(t.db, { to: "ana.r1@example.com", template: "lifecycle.invitee_confirmation", scheduledEventId: m.id })).toHaveLength(0);
  });

  it("calendar invitation mode: moves the same provider event and emails hosts only", async () => {
    const fx = await setupHost(t.db, { google: true });
    const r = await book(fx, la("2030-10-08 13:00"), { invitee: { name: "Ana Lima", email: "ana.r2@example.com", timezone: "Europe/Berlin" } });
    await drain(t.db);
    const first = await meeting(t.db, r.scheduledEventId);
    const [row] = (await linkedRows(t.db, first.id)).filter((x) => x.purpose === "meeting");
    const res = await rescheduleInvitee({ inviteeId: r.inviteeId, start: la("2030-10-10 09:00").toISOString(), actor: invite });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await drain(t.db);
    expect(calls("createEvent")).toHaveLength(1);
    const updates = calls("updateEvent");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.args[1]).toBe(row!.externalId);
    const moved = updates[0]!.args[2] as { start: Date; sendInvitations: boolean; attendees: { email: string }[] };
    expect(moved.start.toISOString()).toBe(la("2030-10-10 09:00").toISOString());
    expect(moved.sendInvitations).toBe(true);
    const rows = await linkedRows(t.db, res.scheduledEventId);
    expect(rows.map((x) => x.id)).toContain(row!.id);
    const m = await meeting(t.db, res.scheduledEventId);
    expect(m.providerIcalUid).toBe(first.providerIcalUid);
    expect(m.location.joinUrl).toBe(first.location.joinUrl); // VID-14: same Meet
    expect(await outbox(t.db, { to: "ana.r2@example.com", scheduledEventId: res.scheduledEventId })).toHaveLength(0);
    expect(await outbox(t.db, { to: fx.owner.email, template: "lifecycle.host_rescheduled", scheduledEventId: res.scheduledEventId })).toHaveLength(1);
  });

  it("refuses when the event type is off, inside the cutoff and after the start; cancel still works", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const r = await book(fx, la("2030-10-08 15:00"));
    await t.db.update(eventTypes).set({ active: false }).where(eq(eventTypes.id, fx.eventTypeId));
    const off = await rescheduleInvitee({ inviteeId: r.inviteeId, start: la("2030-10-09 15:00").toISOString(), actor: invite });
    expect(off).toMatchObject({ ok: false, code: "slot_unavailable", message: "This event can no longer be rescheduled." });
    await t.db.update(eventTypes).set({ active: true, changeCutoffMinutes: 48 * 60 }).where(eq(eventTypes.id, fx.eventTypeId));
    const late = await book(fx, la("2030-10-08 16:00"));
    const cut = await rescheduleInvitee({ inviteeId: late.inviteeId, start: la("2030-10-11 15:00").toISOString(), actor: invite });
    expect(cut).toMatchObject({ ok: false, code: "validation", message: "This meeting can no longer be changed online. Please contact Julian Joseph." });
    setFakeNow(la("2030-10-08 15:10"));
    const past = await rescheduleInvitee({ inviteeId: r.inviteeId, start: la("2030-10-11 15:00").toISOString(), actor: invite });
    expect(past).toMatchObject({ ok: false, message: "This event can no longer be rescheduled." });
    setFakeNow(NOW);
    await t.db.update(eventTypes).set({ active: false }).where(eq(eventTypes.id, fx.eventTypeId));
    await expect(cancelInvitee({ inviteeId: r.inviteeId, actor: invite })).resolves.toMatchObject({ meetingCanceled: true });
  });

  it("host 'Reschedule meeting now' with Override available times for a single host (CR-07, OO-14)", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const r = await book(fx, la("2030-10-08 10:00"));
    const actor = await hostActor(fx);
    const outside = la("2030-10-09 07:00"); // before working hours
    const normal = await rescheduleInvitee({ inviteeId: r.inviteeId, start: outside.toISOString(), actor });
    expect(normal.ok).toBe(false);
    const forced = await rescheduleInvitee({ inviteeId: r.inviteeId, start: outside.toISOString(), actor, host: { overrideAvailability: true } });
    expect(forced.ok).toBe(true);
    if (!forced.ok) return;
    const old = await invitee(t.db, r.inviteeId);
    expect(old.cancelerType).toBe("host");
    await drain(t.db);
    expect(await outbox(t.db, { template: "lifecycle.invitee_rescheduled", scheduledEventId: forced.scheduledEventId })).toHaveLength(1);
  });
});

describe("moveScheduledEvent (MP-21)", () => {
  it("updates the same row with SEQUENCE + 1, moves the provider event and emails the update", async () => {
    const fx = await setupHost(t.db, { google: true, eventType: { notificationType: "email_confirmation", bufferAfterMinutes: 15 } });
    const r = await book(fx, la("2030-10-08 10:00"), { invitee: { name: "Ana Lima", email: "ana.m1@example.com", timezone: "Europe/Berlin" } });
    await drain(t.db);
    const actor = await hostActor(fx);
    const start = la("2030-10-08 12:00");
    await moveScheduledEvent({ scheduledEventId: r.scheduledEventId, start, end: new Date(start.getTime() + 45 * 60_000), actor });
    const m = await meeting(t.db, r.scheduledEventId);
    expect(m.startAt.toISOString()).toBe(start.toISOString());
    expect(m.durationMinutes).toBe(45);
    expect(m.icsSequence).toBe(1);
    const [hostRow] = await t.db.select().from(scheduledEventHosts).where(eq(scheduledEventHosts.scheduledEventId, m.id));
    expect(hostRow!.bufferedEndAt.toISOString()).toBe(new Date(start.getTime() + 60 * 60_000).toISOString());
    await drain(t.db);
    expect(calls("updateEvent")).toHaveLength(1);
    const [mail] = await outbox(t.db, { to: "ana.m1@example.com", template: "lifecycle.invitee_rescheduled", scheduledEventId: m.id });
    expect(mail!.text).toContain("7:00pm - Tuesday, October 8, 2030 (Central European Time)"); // former time, struck
    expect(mail!.text).toContain("9:00pm - Tuesday, October 8, 2030 (Central European Time)");
    expect(icsProps(mail!.ics)).toMatchObject({ UID: m.icsUid, SEQUENCE: "1" });
    expect(await outbox(t.db, { to: fx.owner.email, template: "lifecycle.host_rescheduled", scheduledEventId: m.id })).toHaveLength(1);
  });
});
