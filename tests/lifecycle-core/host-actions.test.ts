// Host actions on PGlite (SPEC CR-08, CR-10, CR-11, CR-12, CR-14, CR-19, CR-20, VID-12, NT-19 events): no-shows,
// notes, invitee limits, removing a group invitee, "Share new times to meet" with its reminder and the rebook, block
// and unblock, reassign (round robin only), Retry, and the permission checks of every service.
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

const { blockedInvitees, domainEvents, inviteeNoShows, invitees: inviteesTable, jobs, scheduledEvents, users } = await import("@/db/schema");
const { setFakeNow, resetFakeTime } = await import("@/lib/time/now");
const { loadActorCtx } = await import("@/lib/authz");
const { createBooking } = await import("@/lib/booking/create");
const { resetFakeProviders } = await import("../helpers/fake-providers");
const { createUser } = await import("../factories");
const { useTestDb } = await import("../helpers/db");
const lc = await import("@/lib/lifecycle/host-actions");
const { removeInvitee, cancelInvitee } = await import("@/lib/lifecycle/cancel");
const { requestReschedule, rescheduleInvitee } = await import("@/lib/lifecycle/reschedule");
const { getInviteeChangeContext } = await import("@/lib/lifecycle/queries");
const h = await import("./helpers");
const { CAFE, DAY, NOW, advance, book, bookingInput, drain, invitee, la, meeting, outbox, setupHost } = h;

const t = useTestDb();
const invite = { type: "invitee" } as const;

beforeEach(() => {
  resetFakeProviders();
  setFakeNow(NOW);
});
afterEach(() => resetFakeTime());

async function actorOf(user: Parameters<typeof loadActorCtx>[1]) {
  return { type: "user" as const, ctx: await loadActorCtx(t.db, user) };
}

describe("no-shows (CR-11)", () => {
  it("only after the start; idempotent; undo; domain events", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const r = await book(fx, la("2030-10-08 10:00"));
    const actor = await actorOf(fx.owner);
    await expect(lc.markNoShow({ inviteeId: r.inviteeId, actor })).rejects.toMatchObject({ code: "validation", message: "You can mark a no-show once the meeting has started." });
    setFakeNow(la("2030-10-08 10:10"));
    const a = await lc.markNoShow({ inviteeId: r.inviteeId, actor });
    const b = await lc.markNoShow({ inviteeId: r.inviteeId, actor });
    expect(b.noShowId).toBe(a.noShowId);
    expect(await t.db.select().from(inviteeNoShows).where(eq(inviteeNoShows.inviteeId, r.inviteeId))).toHaveLength(1);
    expect(await t.db.select().from(domainEvents).where(eq(domainEvents.type, "booking.no_show_created"))).toHaveLength(1);
    await lc.unmarkNoShow({ inviteeId: r.inviteeId, actor });
    expect(await t.db.select().from(inviteeNoShows).where(eq(inviteeNoShows.inviteeId, r.inviteeId))).toHaveLength(0);
    expect(await t.db.select().from(domainEvents).where(eq(domainEvents.type, "booking.no_show_deleted"))).toHaveLength(1);
    await expect(lc.markNoShow({ inviteeId: r.inviteeId, actor: invite })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("notes (CR-14)", () => {
  it("sanitizes, limits to 10,000 characters and never reaches invitee emails", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const r = await book(fx, la("2030-10-08 11:00"), { invitee: { name: "Ana", email: "ana.n@example.com", timezone: "UTC" } });
    const actor = await actorOf(fx.owner);
    await lc.updateMeetingNotes({ scheduledEventId: r.scheduledEventId, html: "<p>Secret plan <script>alert(1)</script><b>bold</b></p>", actor });
    const m = await meeting(t.db, r.scheduledEventId);
    expect(m.meetingNotesHtml).toBe("<p>Secret plan <strong>bold</strong></p>");
    expect(m.meetingNotesPlain).toBe("Secret plan bold");
    await expect(lc.updateMeetingNotes({ scheduledEventId: r.scheduledEventId, html: `<p>${"x".repeat(10_001)}</p>`, actor })).rejects.toMatchObject({ code: "validation" });
    await drain(t.db);
    await cancelInvitee({ inviteeId: r.inviteeId, actor: invite });
    await drain(t.db);
    for (const mail of await outbox(t.db, { to: "ana.n@example.com" })) expect(mail.text).not.toContain("Secret plan");
    await expect(lc.updateMeetingNotes({ scheduledEventId: r.scheduledEventId, html: "x", actor: invite })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("group meetings (CR-10, CR-20)", () => {
  it("removes one of three invitees and edits the slot limit", async () => {
    const fx = await setupHost(t.db, { kind: "group", maxInvitees: 3, locations: [CAFE] });
    const start = la("2030-10-09 10:00");
    const ids: Awaited<ReturnType<typeof book>>[] = [];
    for (const n of ["a", "b", "c"]) ids.push(await book(fx, start, { invitee: { name: n.toUpperCase(), email: `${n}.g@example.com`, timezone: "UTC" } }));
    const actor = await actorOf(fx.owner);
    await expect(lc.setInviteeLimit({ scheduledEventId: ids[0]!.scheduledEventId, limit: 2, actor })).rejects.toMatchObject({
      code: "validation",
      message: "The limit can't be lower than the 3 invitees already booked.",
    });
    await lc.setInviteeLimit({ scheduledEventId: ids[0]!.scheduledEventId, limit: 5, actor });
    expect((await meeting(t.db, ids[0]!.scheduledEventId)).inviteesLimit).toBe(5);
    await removeInvitee({ inviteeId: ids[1]!.inviteeId, actor, reason: "Double booked" });
    const m = await meeting(t.db, ids[0]!.scheduledEventId);
    expect(m.status).toBe("active");
    expect((await invitee(t.db, ids[1]!.inviteeId)).status).toBe("canceled");
    const [ev] = (await t.db.select().from(domainEvents).where(eq(domainEvents.type, "booking.canceled"))).filter((e) => (e.payload as { inviteeId: string }).inviteeId === ids[1]!.inviteeId);
    expect(ev!.payload).toMatchObject({ meetingCanceled: false, cancelerType: "host" });
    await drain(t.db);
    expect(await outbox(t.db, { to: "b.g@example.com", template: "lifecycle.invitee_canceled" })).toHaveLength(1);

    const solo = await setupHost(t.db, { locations: [CAFE] });
    const s = await book(solo, la("2030-10-09 12:00"));
    await expect(lc.setInviteeLimit({ scheduledEventId: s.scheduledEventId, limit: 3, actor: await actorOf(solo.owner) })).rejects.toMatchObject({ message: "Only group events have an invitee limit." });
    await expect(lc.setInviteeLimit({ scheduledEventId: ids[0]!.scheduledEventId, limit: 10_000, actor })).rejects.toMatchObject({ code: "validation" });
  });
});

describe("Share new times to meet (CR-08)", () => {
  it("cancels with the message, emails a Pick a new time link, reminds, and the rebook stops the reminder", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const r = await book(fx, la("2030-10-10 10:00"), { invitee: { name: "Ana Lima", email: "ana.rr@example.com", timezone: "Europe/Berlin" } });
    await drain(t.db);
    const actor = await actorOf(fx.owner);
    await requestReschedule({ inviteeId: r.inviteeId, actor, message: "Could we find another day?", reminderDays: 3 });
    const inv = await invitee(t.db, r.inviteeId);
    expect(inv).toMatchObject({ status: "canceled", cancelerType: "host", cancelReason: "Could we find another day?" });
    await drain(t.db);
    const [mail] = await outbox(t.db, { to: "ana.rr@example.com", template: "lifecycle.request_reschedule" });
    expect(mail!.subject).toBe("Julian Joseph would like to reschedule");
    expect(mail!.text).toContain(`Pick a new time: http://localhost:3000/reschedulings/${r.inviteeId}`);
    expect(mail!.icsMethod).toBe("CANCEL");
    expect(await outbox(t.db, { to: "ana.rr@example.com", template: "lifecycle.invitee_canceled" })).toHaveLength(0);
    const [reminderJob] = await t.db.select().from(jobs).where(eq(jobs.type, "lifecycle.request_reschedule_reminder"));
    expect(Math.abs(reminderJob!.runAt.getTime() - (NOW.getTime() + 3 * DAY))).toBeLessThan(10_000);

    const ctx = await getInviteeChangeContext(r.inviteeId);
    expect(ctx!.rebook).toBe(true);
    expect(ctx!.rescheduleBlock).toBeNull();
    expect(ctx!.cancelBlock?.reason).toBe("canceled");

    const res = await rescheduleInvitee({ inviteeId: r.inviteeId, start: la("2030-10-11 10:00").toISOString(), actor: invite });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((await invitee(t.db, r.inviteeId)).newInviteeId).toBe(res.inviteeId);
    const [after] = await t.db.select().from(jobs).where(eq(jobs.id, reminderJob!.id));
    expect(after!.status).toBe("canceled");
    await drain(t.db);
    expect(await outbox(t.db, { to: "ana.rr@example.com", template: "lifecycle.invitee_confirmation", scheduledEventId: res.scheduledEventId })).toHaveLength(1);
  });

  it("skips the reminder when the invitee booked again on their own", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const r = await book(fx, la("2030-10-10 11:00"), { invitee: { name: "Bo", email: "bo.rr@example.com", timezone: "UTC" } });
    await requestReschedule({ inviteeId: r.inviteeId, actor: await actorOf(fx.owner), reminderDays: 1 });
    await book(fx, la("2030-10-12 11:00"), { invitee: { name: "Bo", email: "bo.rr@example.com", timezone: "UTC" } });
    advance(DAY + 60_000);
    await drain(t.db);
    expect(await outbox(t.db, { to: "bo.rr@example.com", template: "lifecycle.request_reschedule_reminder" })).toHaveLength(0);
    const [job] = await t.db.select().from(jobs).where(eq(jobs.type, "lifecycle.request_reschedule_reminder"));
    expect(job!.status).toBe("succeeded");
  });
});

describe("block and unblock (CR-12)", () => {
  it("cancels upcoming non-group meetings without the reason text and blocks new bookings", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const a = await book(fx, la("2030-10-08 10:00"), { invitee: { name: "Spammer", email: "spam@bad.example", timezone: "UTC" } });
    const b = await book(fx, la("2030-10-09 10:00"), { invitee: { name: "Spammer", email: "spam@bad.example", timezone: "UTC" } });
    const actor = await actorOf(fx.owner);
    // created_at is the database clock; align it with the business clock of this test.
    await t.db.update(inviteesTable).set({ createdAt: NOW }).where(eq(inviteesTable.id, a.inviteeId));
    const out = await lc.blockInvitee({ hostUserId: fx.owner.id, actor, email: "Spam@Bad.example", reason: "Spam", sourceInviteeId: a.inviteeId });
    expect(out.canceledInviteeIds.sort()).toEqual([a.inviteeId, b.inviteeId].sort());
    await drain(t.db);
    const mails = await outbox(t.db, { to: "spam@bad.example", template: "lifecycle.invitee_canceled" });
    expect(mails).toHaveLength(2);
    for (const m of mails) expect(m.text).not.toContain("Reason");
    const again = await createBooking(bookingInput(fx, la("2030-10-11 10:00"), { invitee: { name: "Spammer", email: "spam@bad.example", timezone: "UTC" } }), { now: NOW });
    expect(again.ok).toBe(false);
    await lc.unblockInvitee({ hostUserId: fx.owner.id, blockedId: out.blockedId, actor });
    expect(await t.db.select().from(blockedInvitees).where(eq(blockedInvitees.userId, fx.owner.id))).toHaveLength(0);
    const ok = await createBooking(bookingInput(fx, la("2030-10-11 10:00"), { invitee: { name: "Spammer", email: "spam@bad.example", timezone: "UTC" } }), { now: NOW });
    expect(ok.ok).toBe(true);

    await expect(lc.blockInvitee({ hostUserId: fx.owner.id, actor, email: fx.owner.email })).rejects.toMatchObject({ message: "You can't block yourself." });
    await expect(lc.blockInvitee({ hostUserId: fx.owner.id, actor, domain: "not a domain" })).rejects.toMatchObject({ code: "validation" });
    setFakeNow(new Date(NOW.getTime() + 91 * DAY));
    await expect(lc.blockInvitee({ hostUserId: fx.owner.id, actor, email: "x@y.example", sourceInviteeId: a.inviteeId })).rejects.toMatchObject({
      message: "You can block an invitee within 90 days of their booking.",
    });
    const stranger = await createUser(t.db);
    await expect(lc.blockInvitee({ hostUserId: fx.owner.id, actor: await actorOf(stranger), email: "x@y.example" })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("reassign and retry", () => {
  it("refuses reassigning a non round robin meeting", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const r = await book(fx, la("2030-10-08 13:00"));
    const other = await createUser(t.db);
    await expect(lc.reassignHost({ scheduledEventId: r.scheduledEventId, fromUserId: fx.owner.id, toUserId: other.id, actor: await actorOf(fx.owner) })).rejects.toMatchObject({
      message: "Only round robin meetings can be reassigned to another host.",
    });
  });

  it("Retry re-provisions a meeting whose Meet failed once the Google calendar is connected (VID-12)", async () => {
    const fx = await setupHost(t.db);
    const r = await book(fx, la("2030-10-08 14:00"));
    await drain(t.db);
    expect((await meeting(t.db, r.scheduledEventId)).location.status).toBe("failed");
    const { createCalendarConnection } = await import("../factories");
    const { calendars } = await createCalendarConnection(t.db, { userId: fx.owner.id, provider: "google", accountEmail: fx.owner.email });
    await t.db.update(users).set({ destinationCalendarId: calendars[0]!.id }).where(eq(users.id, fx.owner.id));
    await lc.retryProvisioning({ scheduledEventId: r.scheduledEventId, actor: await actorOf(fx.owner) });
    await drain(t.db);
    const m = await meeting(t.db, r.scheduledEventId);
    expect(m.location.status).toBe("pushed");
    expect(m.provisionStatus).toBe("done");
  });
});

describe("permissions", () => {
  it("users outside the meeting get not found; invitees get forbidden on host actions", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const r = await book(fx, la("2030-10-08 16:00"));
    const outsider = await actorOf(await createUser(t.db));
    await expect(cancelInvitee({ inviteeId: r.inviteeId, actor: outsider })).rejects.toMatchObject({ code: "not_found" });
    await expect(lc.retryProvisioning({ scheduledEventId: r.scheduledEventId, actor: outsider })).rejects.toMatchObject({ code: "not_found" });
    await expect(requestReschedule({ inviteeId: r.inviteeId, actor: invite })).rejects.toMatchObject({ code: "forbidden" });
    await expect(lc.setInviteeLimit({ scheduledEventId: r.scheduledEventId, limit: 2, actor: invite })).rejects.toMatchObject({ code: "forbidden" });
    const sameOrg = await createUser(t.db, { organizationId: fx.owner.organizationId });
    await expect(lc.markNoShow({ inviteeId: r.inviteeId, actor: await actorOf(sameOrg) })).rejects.toMatchObject({ code: "not_found" });
    const admin = await createUser(t.db, { organizationId: fx.owner.organizationId, orgRole: "admin" });
    await expect(lc.updateMeetingNotes({ scheduledEventId: r.scheduledEventId, html: "<p>ok</p>", actor: await actorOf(admin) })).resolves.toBeUndefined();
    const res = await rescheduleInvitee({ inviteeId: r.inviteeId, start: la("2030-10-09 16:00").toISOString(), actor: outsider }).catch((e: unknown) => e);
    expect(res).toMatchObject({ code: "not_found" });
    expect((await t.db.select().from(scheduledEvents).where(and(eq(scheduledEvents.id, r.scheduledEventId))))[0]!.status).toBe("active");
  });
});
