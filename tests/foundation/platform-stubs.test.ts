// Foundation platform stubs (ARCHITECTURE sections 12, 13, 19 and 25): jobs, domain events, email outbox, SMS log,
// ICS, Twilio signatures, i18n, and the minimal real behaviors of the module contracts (Jitsi, locks, invitee chain,
// teams invitations, schedule input). Module contract files that the registries import are mocked here so the runner
// and the dispatcher can be exercised with real handlers.
import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as unknown[], events: [] as unknown[] }));

vi.mock("@/lib/booking/jobs", async () => {
  const { PermanentJobError, RetryLaterError } = await import("@/lib/jobs/types");
  return {
    handlers: {
      "booking.test_ok": async (payload: unknown) => {
        h.calls.push(payload);
        return { result: { done: true } };
      },
      "booking.test_fail": async () => {
        throw new Error("boom");
      },
      "booking.test_permanent": async () => {
        throw new PermanentJobError("nope");
      },
      "booking.test_retry": async () => {
        throw new RetryLaterError(60_000, "later");
      },
    },
    periodic: [{ type: "booking.test_periodic", everyMinutes: 60 }],
  };
});
// Only the contacts test subscriber listens to booking.created here; real module subscribers (workflows) are muted.
vi.mock("@/lib/workflows/subscribers", () => ({ subscribers: {} }));
vi.mock("@/lib/contacts/subscribers", () => ({
  subscribers: {
    "booking.created": async (event: unknown) => {
      h.events.push(event);
    },
  },
}));

const { availabilityDateOverrides, domainEvents, emailOutbox, invitees, jobs, organizationInvitations, organizationMemberships, smsMessages, teamMemberships } =
  await import("@/db/schema");
const { cancelJobs, enqueueJob, runDueJobs } = await import("@/lib/jobs");
const { publishEvent } = await import("@/lib/events");
const { subscriberKeysFor, SUBSCRIBER_KEYS } = await import("@/lib/events/registry");
const { PERIODIC_JOBS, getJobHandler } = await import("@/lib/jobs/registry");
const { buildIcs, escapeHtml, htmlToText, sendEmail } = await import("@/lib/email");
const { sendSms, verifyTwilioSignature } = await import("@/lib/sms");
const { getMessages, getT, resolveLocale } = await import("@/lib/i18n");
const { createConference, conferenceMode, resolveConferenceOrganizer } = await import("@/lib/conferencing");
const { blockedDatesFor, getHolidays, SUPPORTED_COUNTRIES } = await import("@/lib/holidays");
const { groupSlotsByLocalDate, lockHostsInTx, lockInviteeForChangeInTx } = await import("@/lib/booking");
const { resolveActiveInviteeChain } = await import("@/lib/lifecycle");
const { acceptInvitationInTx, getPendingInvitation, getTeamPublicProfile, listTeamsForUser } = await import("@/lib/teams");
const { ensureDefaultSchedule, getDefaultSchedule, loadScheduleInput } = await import("@/lib/availability");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { isAppError } = await import("@/lib/errors");
const { createBooking, createEventType, createInvitation, createSchedule, createTeam, createUser } = await import("../factories");
const { useTestDb } = await import("../helpers/db");

const t = useTestDb();

beforeEach(async () => {
  await t.db.delete(jobs);
  h.calls.length = 0;
  h.events.length = 0;
});
afterEach(() => resetFakeTime());

const jobById = async (id: string) => (await t.db.select().from(jobs).where(eq(jobs.id, id)))[0]!;

describe("jobs", () => {
  it("enqueueJob always writes run_at from now() and dedupes by idempotency key", async () => {
    setFakeNow("2030-05-01T10:00:00Z");
    const id = await enqueueJob(t.db, { type: "booking.test_ok", payload: { a: 1 }, idempotencyKey: "k1" });
    expect(id).toBeTruthy();
    expect(await enqueueJob(t.db, { type: "booking.test_ok", idempotencyKey: "k1" })).toBeNull();
    const row = await jobById(id!);
    expect(Math.abs(row.runAt.getTime() - Date.parse("2030-05-01T10:00:00Z"))).toBeLessThan(5_000);
    expect(row.status).toBe("pending");
  });

  it("cancelJobs cancels pending jobs of a group and needs a filter", async () => {
    const a = await enqueueJob(t.db, { type: "booking.test_ok", groupKey: "wf:1" });
    const b = await enqueueJob(t.db, { type: "booking.test_ok", groupKey: "wf:2" });
    expect(await cancelJobs(t.db, {})).toBe(0);
    expect(await cancelJobs(t.db, { groupKey: "wf:1" })).toBe(1);
    expect((await jobById(a!)).status).toBe("canceled");
    expect((await jobById(b!)).status).toBe("pending");
    expect(await cancelJobs(t.db, { ids: [] })).toBe(0);
  });

  it("runs due jobs: success, retry with backoff, dead letters, permanent errors, RetryLater and missing handlers", async () => {
    setFakeNow("2030-05-01T10:00:00Z");
    const ok = await enqueueJob(t.db, { type: "booking.test_ok", payload: { n: 1 } });
    const fail = await enqueueJob(t.db, { type: "booking.test_fail", maxAttempts: 2 });
    const perm = await enqueueJob(t.db, { type: "booking.test_permanent" });
    const later = await enqueueJob(t.db, { type: "booking.test_retry" });
    const none = await enqueueJob(t.db, { type: "nobody.handles_this" });
    const future = await enqueueJob(t.db, { type: "booking.test_ok", runAt: new Date("2030-05-02T00:00:00Z") });

    const r1 = await runDueJobs({ budgetMs: 10_000, types: ["booking.*", "nobody.*"] });
    expect(r1.ran).toBe(5);
    expect(r1.succeeded).toBe(1);
    expect(h.calls).toEqual([{ n: 1 }]);
    expect(await jobById(ok!)).toMatchObject({ status: "succeeded", result: { done: true } });

    const failed = await jobById(fail!);
    expect(failed).toMatchObject({ status: "pending", attempts: 1 });
    expect(failed.lastError).toContain("boom");
    // fake time is an offset over the real clock: allow the milliseconds the test itself takes
    expect(failed.runAt.getTime() - Date.parse("2030-05-01T10:00:30Z")).toBeGreaterThanOrEqual(0);
    expect(failed.runAt.getTime() - Date.parse("2030-05-01T10:00:30Z")).toBeLessThan(5_000);

    expect(await jobById(perm!)).toMatchObject({ status: "dead" });
    expect(await jobById(later!)).toMatchObject({ status: "pending", attempts: 0 });
    const noHandler = await jobById(none!);
    expect(noHandler).toMatchObject({ status: "pending", lastError: "no_handler", attempts: 0 });
    expect(Math.abs(noHandler.runAt.getTime() - Date.parse("2030-05-01T11:00:00Z"))).toBeLessThan(5_000);
    expect((await jobById(future!)).status).toBe("pending");

    setFakeNow("2030-05-01T10:01:00Z");
    await runDueJobs({ budgetMs: 10_000, types: ["booking.test_fail"] });
    expect(await jobById(fail!)).toMatchObject({ status: "dead", attempts: 2 });

    setFakeNow("2030-05-02T00:00:01Z");
    await runDueJobs({ budgetMs: 10_000, types: ["booking.test_ok"] });
    expect((await jobById(future!)).status).toBe("succeeded");
  });

  it("recovers stuck running jobs and schedules periodic jobs once per bucket", async () => {
    setFakeNow("2030-06-01T12:00:00Z");
    const stuck = await enqueueJob(t.db, { type: "booking.test_ok" });
    await t.db
      .update(jobs)
      .set({ status: "running", lockedUntil: new Date("2030-06-01T11:00:00Z"), lockedBy: "dead-worker" })
      .where(eq(jobs.id, stuck!));
    await runDueJobs({ budgetMs: 10_000 });
    expect((await jobById(stuck!)).status).toBe("succeeded");
    await runDueJobs({ budgetMs: 10_000 });
    const periodic = await t.db.select().from(jobs).where(eq(jobs.type, "booking.test_periodic"));
    expect(periodic).toHaveLength(1);
    expect(PERIODIC_JOBS.some((p) => p.type === "system.cleanup")).toBe(true);
    expect(getJobHandler("system.cleanup")).toBeTypeOf("function");
    expect(getJobHandler("event:booking.created:contacts")).toBeTypeOf("function");
    expect(getJobHandler("unknown.type")).toBeNull();
  });
});

describe("domain events", () => {
  it("registers every subscriber key of ARCHITECTURE 12.1", () => {
    expect([...SUBSCRIBER_KEYS].sort()).toEqual(
      ["analytics", "contacts", "lifecycle", "links", "payments", "polls", "routing", "webhooks", "workflows"].sort(),
    );
    expect(subscriberKeysFor("booking.created")).toEqual(["contacts"]);
    expect(subscriberKeysFor("poll.created")).toEqual([]);
  });

  it("publishEvent writes domain_events plus one job per subscriber key, and the dispatcher runs it", async () => {
    const owner = await createUser(t.db);
    const id = await t.db.transaction((tx) =>
      publishEvent(
        tx,
        "booking.created",
        { scheduledEventId: "00000000-0000-4000-8000-000000000001", inviteeId: "00000000-0000-4000-8000-000000000002", source: "booking_page" },
        { organizationId: owner.organizationId, actor: { type: "invitee" } },
      ),
    );
    const [event] = await t.db.select().from(domainEvents).where(eq(domainEvents.id, id));
    expect(event).toMatchObject({ type: "booking.created", organizationId: owner.organizationId, actor: { type: "invitee" } });
    const eventJobs = await t.db.select().from(jobs).where(eq(jobs.idempotencyKey, `${id}:contacts`));
    expect(eventJobs).toHaveLength(1);
    expect(eventJobs[0]).toMatchObject({ type: "event:booking.created:contacts", priority: 10 });

    const r = await runDueJobs({ budgetMs: 10_000, types: ["event:booking.created:*"] });
    expect(r.succeeded).toBe(1);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({
      id,
      type: "booking.created",
      payload: { source: "booking_page" },
      meta: { organizationId: owner.organizationId },
    });
  });
});

describe("email, SMS and ICS", () => {
  it("sendEmail stores messages in the outbox and is idempotent by key", async () => {
    const msg = {
      to: ["invitee@example.com"],
      subject: "Hello",
      html: "<p>Hi <a href=\"https://x.test/a\">there</a></p>",
      text: "Hi there",
      template: "test.hello",
      category: "transactional" as const,
      idempotencyKey: "email:test:1",
      replyTo: null,
    };
    const first = await sendEmail(msg);
    expect(first).toMatchObject({ status: "stored", deduplicated: false });
    const second = await sendEmail({ ...msg, subject: "Changed" });
    expect(second).toMatchObject({ id: first.id, status: "stored", deduplicated: true });
    const [row] = await t.db.select().from(emailOutbox).where(eq(emailOutbox.id, first.id));
    expect(row).toMatchObject({ subject: "Hello", provider: "outbox", replyTo: null, toAddresses: ["invitee@example.com"] });
    expect(row?.fromAddress).toContain("notifications@localhost");
    expect(htmlToText(msg.html)).toBe("Hi there (https://x.test/a)");
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("sendSms stores messages in the log and is idempotent by key", async () => {
    const a = await sendSms({ to: "+14155550100", body: "Reminder", idempotencyKey: "sms:test:1" });
    const b = await sendSms({ to: "+14155550100", body: "Reminder", idempotencyKey: "sms:test:1" });
    expect(a.status).toBe("stored");
    expect(b.id).toBe(a.id);
    const rows = await t.db.select().from(smsMessages).where(eq(smsMessages.idempotencyKey, "sms:test:1"));
    expect(rows).toHaveLength(1);
  });

  it("buildIcs emits a valid UTC VEVENT with CRLF and folded lines", () => {
    const ics = buildIcs({
      method: "REQUEST",
      uid: "abc@kairos.test",
      sequence: 2,
      start: new Date("2026-10-20T15:00:00Z"),
      end: new Date("2026-10-20T15:30:00Z"),
      summary: "30 Minute Meeting, with Jane; and a very long title that needs folding because it is long",
      description: "Line 1\nLine 2",
      location: "Room 1",
      organizer: { name: "Host", email: "host@example.com" },
      attendees: [{ name: "Jane", email: "jane@example.com" }],
      status: "CONFIRMED",
    });
    expect(ics).toContain("METHOD:REQUEST\r\n");
    expect(ics).toContain("UID:abc@kairos.test\r\n");
    expect(ics).toContain("SEQUENCE:2\r\n");
    expect(ics).toContain("DTSTART:20261020T150000Z\r\n");
    expect(ics).toContain("DTEND:20261020T153000Z\r\n");
    expect(ics).toContain("DESCRIPTION:Line 1\\nLine 2");
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
  });

  it("verifyTwilioSignature accepts a correct signature and rejects a tampered parameter", () => {
    const url = "https://example.com/api/webhooks/twilio";
    const params = { From: "+14155550100", Body: "STOP", To: "+14155550199" };
    const data = url + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join("");
    const signature = createHmac("sha1", "secret-token").update(data).digest("base64");
    expect(verifyTwilioSignature({ url, params, signature, authToken: "secret-token" })).toBe(true);
    expect(verifyTwilioSignature({ url, params: { ...params, Body: "START" }, signature, authToken: "secret-token" })).toBe(false);
    expect(verifyTwilioSignature({ url, params, signature: null, authToken: "secret-token" })).toBe(false);
  });
});

describe("i18n", () => {
  it("falls back to English per key, interpolates placeholders and returns unknown keys as is", () => {
    expect(getT("fr", "booking")("details.title")).toBe("Enter Details");
    expect(getT("en", "common")("footer.poweredBy", { appName: "Kairos" })).toBe("Powered by Kairos");
    expect(getT("de", "common")("does.not.exist")).toBe("does.not.exist");
    expect(getT("en", "zones")("America/New_York")).toContain("Eastern Time");
    expect(resolveLocale("pt-BR")).toBe("pt");
    expect(resolveLocale("zz")).toBe("en");
    expect(getMessages("uk", "payments").step.continue).toBe("Continue to payment");
  });
});

describe("module contract minimal behaviors", () => {
  it("conferencing creates Jitsi links and reports other kinds as not configured", async () => {
    const base = { organizerUserId: "u", scheduledEventId: "e", title: "T", start: new Date(), end: new Date(), timeZone: "UTC", inviteeEmails: [] };
    const jitsi = await createConference({ ...base, kind: "jitsi_conference" });
    expect(jitsi.status).toBe("pushed");
    expect(jitsi.joinUrl).toMatch(/^https:\/\/meet\.jit\.si\/kairos-[a-z0-9]{20}$/);
    const zoom = await createConference({ ...base, kind: "zoom_conference" });
    expect(zoom).toMatchObject({ status: "failed", error: "not_configured" });
    expect(conferenceMode("google_conference")).toBe("calendar_native");
    expect(conferenceMode("physical")).toBe("none");
    expect(
      resolveConferenceOrganizer({ organizerUserId: "a", hosts: [{ userId: "p", poolId: "pool" }, { userId: "r", poolId: null }] }),
    ).toBe("r");
  });

  it("holidays: real data for the 10 supported countries", () => {
    expect(SUPPORTED_COUNTRIES).toHaveLength(10);
    expect(getHolidays("US", 2026).some((h) => h.key === "US:4th_thursday_in_november" && h.date === "2026-11-26")).toBe(true);
    expect(blockedDatesFor("US", {}, "2026-01-01", "2026-12-31", "UTC")).toContain("2026-11-26");
  });

  it("booking lock helpers lock hosts and refuse to change a canceled or rescheduled invitee", async () => {
    const owner = await createUser(t.db);
    const { eventType } = await createEventType(t.db, { owner });
    const active = await createBooking(t.db, { eventType, start: "2030-01-10T15:00:00Z" });
    const canceled = await createBooking(t.db, { eventType, start: "2030-01-11T15:00:00Z", invitee: { status: "canceled" } });
    await t.db.transaction(async (tx) => {
      await lockHostsInTx(tx, [owner.id, owner.id]);
      const row = await lockInviteeForChangeInTx(tx, active.invitee!.id);
      expect(row.id).toBe(active.invitee!.id);
    });
    const err = await t.db.transaction((tx) => lockInviteeForChangeInTx(tx, canceled.invitee!.id)).catch((e: unknown) => e);
    expect(isAppError(err) && err.code === "conflict").toBe(true);
    const missing = await t.db
      .transaction((tx) => lockInviteeForChangeInTx(tx, "00000000-0000-4000-8000-000000000009"))
      .catch((e: unknown) => e);
    expect(isAppError(missing) && missing.code === "not_found").toBe(true);
    expect(groupSlotsByLocalDate([{ start: Date.parse("2030-01-10T23:30:00Z"), end: 0, inviteesRemaining: 2, eligibleHostIds: [], eligibleByPool: {} }], "America/New_York")).toEqual({
      "2030-01-10": [{ start: "2030-01-10T23:30:00.000Z", remaining: 2 }],
    });
  });

  it("resolveActiveInviteeChain follows new_invitee_id to the active invitee", async () => {
    const owner = await createUser(t.db);
    const { eventType } = await createEventType(t.db, { owner });
    const first = await createBooking(t.db, { eventType, start: "2030-02-01T15:00:00Z" });
    const second = await createBooking(t.db, { eventType, start: "2030-02-02T15:00:00Z" });
    const third = await createBooking(t.db, { eventType, start: "2030-02-03T15:00:00Z" });
    await t.db.update(invitees).set({ status: "canceled", rescheduled: true, newInviteeId: second.invitee!.id }).where(eq(invitees.id, first.invitee!.id));
    await t.db.update(invitees).set({ status: "canceled", rescheduled: true, newInviteeId: third.invitee!.id }).where(eq(invitees.id, second.invitee!.id));
    expect((await resolveActiveInviteeChain(first.invitee!.id))?.id).toBe(third.invitee!.id);
    expect(await resolveActiveInviteeChain("00000000-0000-4000-8000-000000000009")).toBeNull();
  });

  it("teams: pending invitations by token and acceptance in a transaction", async () => {
    const admin = await createUser(t.db);
    const { team } = await createTeam(t.db, { organizationId: admin.organizationId, name: "Sales" });
    const { invitation, token } = await createInvitation(t.db, {
      organizationId: admin.organizationId,
      email: "new@example.com",
      role: "admin",
      teamIds: [team.id],
      invitedByUserId: admin.id,
    });
    const pending = await getPendingInvitation(token);
    expect(pending).toMatchObject({ id: invitation.id, email: "new@example.com", role: "admin", teamIds: [team.id] });
    expect(await getPendingInvitation("wrong-token")).toBeNull();

    const joiner = await createUser(t.db, { withoutHandle: false, organizationId: admin.organizationId, orgRole: "admin" });
    await t.db.transaction((tx) => acceptInvitationInTx(tx, { invitationId: invitation.id, userId: joiner.id }));
    const [inv] = await t.db.select().from(organizationInvitations).where(eq(organizationInvitations.id, invitation.id));
    expect(inv).toMatchObject({ status: "accepted", acceptedUserId: joiner.id });
    const tm = await t.db.select().from(teamMemberships).where(and(eq(teamMemberships.teamId, team.id), eq(teamMemberships.userId, joiner.id)));
    expect(tm).toHaveLength(1);
    expect(await getPendingInvitation(token)).toBeNull();
    const again = await t.db.transaction((tx) => acceptInvitationInTx(tx, { invitationId: invitation.id, userId: joiner.id })).catch((e: unknown) => e);
    expect(isAppError(again) && again.code === "not_found").toBe(true);
    expect((await listTeamsForUser(joiner.id)).map((x) => x.name)).toEqual(["Sales"]);
    expect((await getTeamPublicProfile(team.slug))?.team.name).toBe("Sales");
    const memberships = await t.db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, joiner.id));
    expect(memberships).toHaveLength(1);
  });

  it("availability: default schedule and schedule input with overrides in range", async () => {
    const owner = await createUser(t.db, { timezone: "Europe/Berlin" });
    const created = await t.db.transaction((tx) => ensureDefaultSchedule(tx, owner.id, { timezone: "Europe/Berlin" }));
    const again = await t.db.transaction((tx) => ensureDefaultSchedule(tx, owner.id, { timezone: "UTC" }));
    expect(again.id).toBe(created.id);
    expect((await getDefaultSchedule(owner.id))?.id).toBe(created.id);
    const other = await createSchedule(t.db, { userId: owner.id, name: "Other", isDefault: false, timezone: "Europe/Berlin" });
    await t.db.insert(availabilityDateOverrides).values([
      { scheduleId: other.id, date: "2030-03-10", intervals: [] },
      { scheduleId: other.id, date: "2030-05-01", intervals: [{ start: 600, end: 660 }] },
    ]);
    const input = await loadScheduleInput(other.id, { start: new Date("2030-03-09T00:00:00Z"), end: new Date("2030-03-12T00:00:00Z") });
    expect(input).toMatchObject({ timeZone: "Europe/Berlin", overrides: { "2030-03-10": [] }, blockedDates: [] });
    expect(input?.overrides["2030-05-01"]).toBeUndefined();
    expect(await loadScheduleInput("00000000-0000-4000-8000-000000000009", { start: new Date(), end: new Date() })).toBeNull();
  });
});
