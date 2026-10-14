// The Gmail email transport end to end on PGlite with a fake Gmail API (users.messages.send) and Google token
// endpoint: emails go out from the owner's Gmail (owner name, Gmail address, Reply-To, headers, the invitation), never
// twice, with tokens refreshed through the calendar connection helpers; a revoked token (invalid_grant), a second 401
// or a missing gmail.send permission marks the connection for reconnect (dashboard banner) and holds the email in the
// outbox with a clear reason until the owner reconnects; 429 (Retry-After), 5xx and a disabled Gmail API are retried
// with backoff by the email.retry job, other 4xx fail for good; held emails that are no longer useful are given up;
// stored emails log the email outbox page.
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection, FakeGmail } from "./helpers";

vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));
// Other modules' jobs files are contracts owned by their modules: isolate the runner from them.
vi.mock("@/lib/admin/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/booking/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/calendars/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/contacts/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/lifecycle/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/links/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/meetings/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/payments/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/polls/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/settings/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/teams/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/webhooks/jobs", () => ({ handlers: {}, periodic: [] }));
vi.mock("@/lib/workflows/jobs", () => ({ handlers: {}, periodic: [] }));

const { calendarConnections, emailOutbox, instanceSettings, jobs } = await import("@/db/schema");
const email = await import("@/lib/email");
const { runDueJobs } = await import("@/lib/jobs");
const { getCalendarHealth } = await import("@/lib/calendars/health");
const { decrypt } = await import("@/lib/crypto");
const { nowMs, resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { useTestDb } = await import("../helpers/db");
const { createBooking, createEventType, createUser } = await import("../factories");
const h = await import("./helpers");

type TestUser = Awaited<ReturnType<typeof createUser>>;

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;
const ENV_KEYS = ["RESEND_API_KEY", "SMTP_HOST", "EMAIL_PROVIDER", "EMAIL_FROM", "LOG_LEVEL"];
const MIN = 60_000;
const HOUR = 60 * MIN;

let owner: TestUser;
let conn: Connection;
let gmail: FakeGmail;

const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:evt-1@localhost\r\nDTSTART:20261020T140000Z\r\nDTEND:20261020T143000Z\r\nSUMMARY:30 Minute Meeting\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

const base = (over: Partial<Parameters<typeof email.sendEmail>[0]> = {}) => ({
  to: ["Sam Rivera <sam@example.com>"],
  subject: "Confirmed: 30 Minute Meeting with Jordan Lée on Tuesday, October 20, 2026",
  html: "<p>Hi Sam,</p><p>Your meeting is confirmed.</p>",
  text: "Hi Sam,\n\nYour meeting is confirmed.",
  template: "lifecycle.invitee_confirmation",
  category: "transactional" as const,
  idempotencyKey: `gmail:${Math.random().toString(36).slice(2)}`,
  ...over,
});

const row = async (id: string) => (await t.db.select().from(emailOutbox).where(eq(emailOutbox.id, id)))[0]!;
const connection = async () => (await t.db.select().from(calendarConnections).where(eq(calendarConnections.id, conn.id)))[0]!;
const retryJob = async (outboxId: string) => (await t.db.select().from(jobs).where(eq(jobs.idempotencyKey, `email.retry:${outboxId}`)))[0];
const runEmailJobs = () => runDueJobs({ budgetMs: 20_000, types: ["email.retry"], workerId: "test" });

beforeAll(async () => {
  owner = await createUser(t.db, { name: "Jordan Lée", email: "jordan@example.com", isInstanceAdmin: true });
});

beforeEach(async () => {
  for (const k of ENV_KEYS) delete env[k];
  env.GOOGLE_CLIENT_ID = "google-client";
  env.GOOGLE_CLIENT_SECRET = "google-secret";
  await t.db.delete(emailOutbox);
  await t.db.delete(jobs);
  await t.db.delete(instanceSettings);
  await t.db.delete(calendarConnections).where(eq(calendarConnections.userId, owner.id));
  conn = await h.connectGoogle(t.db, owner);
  gmail = h.fakeGmail();
});

afterEach(() => {
  gmail.restore();
  vi.restoreAllMocks();
  resetFakeTime();
  for (const k of [...ENV_KEYS, "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) delete env[k];
});

describe("sending from the owner's Gmail", () => {
  it("sends the base64url raw message as the owner (name and Gmail address) with Reply-To, headers and the invitation", async () => {
    const res = await email.sendEmail(
      base({
        replyTo: "jordan@example.com",
        fromName: "Jordan Lée via Kairos",
        ics: { method: "REQUEST", content: ICS },
        listUnsubscribe: { url: "http://localhost:3000/p/abc/unsubscribe?t=tok" },
      }),
    );
    expect(res).toMatchObject({ status: "sent", deduplicated: false });
    const r = await row(res.id);
    expect(r).toMatchObject({
      status: "sent",
      provider: "gmail",
      providerMessageId: "gm-1",
      fromAddress: conn.address,
      fromName: "Jordan Lée",
      attempts: 1,
      lastError: null,
    });
    expect(gmail.calls).toHaveLength(1);
    const call = gmail.calls[0]!;
    expect(call.authorization).toBe("Bearer access-1");
    const m = call.message;
    expect(m.header("from")).toBe(`Jordan Lée <${conn.address}>`);
    expect(m.header("to")).toBe("Sam Rivera <sam@example.com>");
    expect(m.header("reply-to")).toBe("jordan@example.com");
    expect(m.header("subject")).toBe("Confirmed: 30 Minute Meeting with Jordan Lée on Tuesday, October 20, 2026");
    expect(m.header("message-id")).toBe(email.outboxMessageId(res.id));
    expect(m.header("auto-submitted")).toBe("auto-generated");
    expect(m.header("list-unsubscribe")).toBe("<http://localhost:3000/p/abc/unsubscribe?t=tok>");
    expect(m.header("list-unsubscribe-post")).toBe("List-Unsubscribe=One-Click");
    const calendar = m.parts[0]!.parts.find((p) => p.contentType === "text/calendar")!;
    expect(calendar.params.method).toBe("REQUEST");
    expect(m.parts[1]!.params.name ?? m.parts[1]!.dispositionParams.filename).toBe("invite.ics");
  });

  it("never sends twice: repeated and concurrent sendEmail calls with one key deliver once", async () => {
    const msg = base();
    const [a, b] = await Promise.all([email.sendEmail(msg), email.sendEmail(msg)]);
    const again = await email.sendEmail(msg);
    expect(a.id).toBe(b.id);
    expect(again).toMatchObject({ id: a.id, status: "sent", deduplicated: true });
    expect([a.deduplicated, b.deduplicated].filter(Boolean)).toHaveLength(1);
    expect(gmail.calls).toHaveLength(1);
    expect((await row(a.id)).status).toBe("sent");
    // A sent row is never retried by the job or the sweep.
    expect(await email.retryEmailDelivery(a.id)).toBe("skipped");
    await email.sweepStuckEmails();
    expect(gmail.calls).toHaveLength(1);
  });

  it("strips header injection from the subject before it reaches Gmail", async () => {
    await email.sendEmail(base({ subject: "Hello\r\nBcc: attacker@example.com" }));
    const m = gmail.calls[0]!.message;
    expect(m.header("bcc")).toBeNull();
    expect(m.header("subject")).toBe("Hello Bcc: attacker@example.com");
  });
});

describe("tokens", () => {
  it("refreshes an expiring access token through the Google token helpers and keeps the stored refresh token", async () => {
    await t.db.update(calendarConnections).set({ tokenExpiresAt: new Date(nowMs() + MIN) }).where(eq(calendarConnections.id, conn.id));
    const res = await email.sendEmail(base());
    expect(res.status).toBe("sent");
    expect(gmail.tokenCalls).toHaveLength(1);
    expect(gmail.tokenCalls[0]!.body).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh-1" });
    expect(gmail.calls[0]!.authorization).toBe("Bearer access-refreshed-1");
    const c = await connection();
    expect(await decrypt(c.accessTokenEnc!)).toBe("access-refreshed-1");
    expect(await decrypt(c.refreshTokenEnc!)).toBe("refresh-1");
    expect(c.tokenExpiresAt!.getTime()).toBeGreaterThan(nowMs() + 50 * MIN);
  });

  it("refreshes once on a 401 from Gmail and sends with the new token", async () => {
    gmail.sendAnswers.push(h.gmailError(401, "authError", "Invalid Credentials"));
    const res = await email.sendEmail(base());
    expect(res.status).toBe("sent");
    expect(gmail.calls.map((c) => c.authorization)).toEqual(["Bearer access-1", "Bearer access-refreshed-1"]);
    expect(gmail.tokenCalls).toHaveLength(1);
    expect((await connection()).status).toBe("active");
    // Both attempts carried the same Message-ID (one message).
    expect(new Set(gmail.calls.map((c) => c.message.header("message-id"))).size).toBe(1);
  });

  it("holds the email when the refresh token is revoked, marks the connection for reconnect and shows the banner", async () => {
    await t.db.update(calendarConnections).set({ tokenExpiresAt: new Date(nowMs() - MIN) }).where(eq(calendarConnections.id, conn.id));
    gmail.tokenAnswers.push(h.invalidGrant());
    const first = await email.sendEmail(base({ listUnsubscribe: { url: "http://localhost:3000/p/abc/unsubscribe?t=tok" } }));
    expect(first).toMatchObject({ status: "failed", deduplicated: false });
    const held = await row(first.id);
    expect(held.status).toBe("failed");
    expect(held.provider).toBe("gmail");
    expect(held.lastError).toMatch(new RegExp(`^${email.GMAIL_HOLD_PREFIX}`));
    expect(held.lastError).toContain(conn.address);
    expect(held.lastError).toContain("Reconnect");
    expect(email.isHeldForGmail(held)).toBe(true);
    expect(gmail.calls).toHaveLength(0);
    // The connection needs a reconnect: the dashboard's calendar connection banner and the problem email follow.
    expect((await connection()).status).toBe("needs_reauth");
    expect((await getCalendarHealth(owner.id)).brokenConnections).toEqual([{ id: conn.id, email: conn.address, status: "needs_reauth" }]);
    expect(await t.db.select().from(jobs).where(eq(jobs.type, "calendars.connection_problem"))).toHaveLength(1);
    // No retry with backoff burns its attempts: its job (carrying the headers) waits for the end of the hold window.
    const job = (await retryJob(first.id))!;
    expect(job.status).toBe("pending");
    expect(job.runAt.getTime()).toBeGreaterThan(nowMs() + 23 * HOUR);
    expect((job.payload as { headers: Record<string, string> }).headers["List-Unsubscribe"]).toBe("<http://localhost:3000/p/abc/unsubscribe?t=tok>");
    expect(await email.retryEmailDelivery(first.id)).toBe("skipped");
    await email.sweepStuckEmails();
    expect((await row(first.id)).attempts).toBe(held.attempts);

    // While the connection needs a reconnect, new emails wait right away without calling Google.
    const second = await email.sendEmail(base());
    expect(second.status).toBe("failed");
    expect(await row(second.id)).toMatchObject({ status: "failed", attempts: 0 });
    expect(email.isHeldForGmail(await row(second.id))).toBe(true);
    expect(gmail.tokenCalls).toHaveLength(1);
    expect(gmail.calls).toHaveLength(0);
    expect(await email.countHeldEmails()).toBe(2);

    // The owner reconnects: the sweep releases both, each goes out exactly once with its original headers.
    await h.reconnect(t.db, conn.id);
    expect(await email.sweepStuckEmails()).toBe(2);
    await runEmailJobs();
    expect(gmail.calls).toHaveLength(2);
    expect((await row(first.id)).status).toBe("sent");
    expect((await row(second.id)).status).toBe("sent");
    const firstCall = gmail.calls.find((c) => c.message.header("message-id") === email.outboxMessageId(first.id))!;
    expect(firstCall.message.header("list-unsubscribe")).toBe("<http://localhost:3000/p/abc/unsubscribe?t=tok>");
    expect(firstCall.authorization).toBe("Bearer access-reconnected");
    await email.sweepStuckEmails();
    await runEmailJobs();
    expect(gmail.calls).toHaveLength(2);
    expect(await email.countHeldEmails()).toBe(0);
  });

  it("a 401 after the refresh holds the email and marks the connection for reconnect", async () => {
    gmail.sendAnswers.push(h.gmailError(401, "authError", "Invalid Credentials"), h.gmailError(401, "authError", "Invalid Credentials"));
    const res = await email.sendEmail(base());
    expect(res.status).toBe("failed");
    expect(email.isHeldForGmail(await row(res.id))).toBe(true);
    expect(gmail.tokenCalls).toHaveLength(1);
    expect((await connection()).status).toBe("needs_reauth");
  });

  it("a missing gmail.send permission (403 insufficient scope) holds the email for a reconnect", async () => {
    gmail.sendAnswers.push(h.gmailError(403, "insufficientPermissions", "Request had insufficient authentication scopes."));
    const res = await email.sendEmail(base());
    const r = await row(res.id);
    expect(email.isHeldForGmail(r)).toBe(true);
    expect(r.lastError).toContain("Send email on your behalf");
    expect((await connection()).status).toBe("needs_reauth");
  });
});

describe("retries", () => {
  it("retries a 429 with backoff that honors Retry-After, then sends once with the same Message-ID", async () => {
    const t0 = Date.parse("2030-03-04T10:00:00Z");
    setFakeNow(t0);
    await t.db.update(calendarConnections).set({ tokenExpiresAt: new Date(t0 + 48 * HOUR) }).where(eq(calendarConnections.id, conn.id));
    gmail.sendAnswers.push(h.gmailError(429, "rateLimitExceeded", "User-rate limit exceeded", { "Retry-After": "120" }));
    const res = await email.sendEmail(base());
    expect(res.status).toBe("failed");
    const failed = await row(res.id);
    expect(failed.lastError).toMatch(/^gmail 429 rateLimitExceeded/);
    expect(email.isHeldForGmail(failed)).toBe(false);
    const job = (await retryJob(res.id))!;
    expect(job.status).toBe("pending");
    expect(job.runAt.getTime() - nowMs()).toBeGreaterThanOrEqual(119_000);
    expect(job.runAt.getTime() - nowMs()).toBeLessThanOrEqual(121_000);

    // Not due yet.
    await runEmailJobs();
    expect(gmail.calls).toHaveLength(1);

    // The job's attempt hits another 429: the handler throws, so the runner backs off.
    setFakeNow(t0 + 3 * MIN);
    gmail.sendAnswers.push(h.gmailError(429, "rateLimitExceeded", "User-rate limit exceeded"));
    await runEmailJobs();
    expect(gmail.calls).toHaveLength(2);
    const backedOff = (await retryJob(res.id))!;
    expect(backedOff).toMatchObject({ status: "pending", attempts: 1 });
    expect(backedOff.runAt.getTime()).toBeGreaterThan(nowMs());
    expect((await row(res.id)).status).toBe("failed");

    setFakeNow(t0 + HOUR);
    await runEmailJobs();
    expect(gmail.calls).toHaveLength(3);
    expect(await row(res.id)).toMatchObject({ status: "sent", attempts: 3, lastError: null });
    expect(new Set(gmail.calls.map((c) => c.message.header("message-id")))).toEqual(new Set([email.outboxMessageId(res.id)]));
    setFakeNow(t0 + 2 * HOUR);
    await runEmailJobs();
    expect(gmail.calls).toHaveLength(3);
  });

  it("retries 5xx and a disabled Gmail API with backoff, and fails other 4xx for good", async () => {
    gmail.sendAnswers.push(h.gmailError(503, "backendError", "Backend Error"));
    const server = await email.sendEmail(base());
    expect((await row(server.id)).lastError).toMatch(/^gmail 503/);
    expect((await retryJob(server.id))?.status).toBe("pending");

    gmail.sendAnswers.push(h.gmailError(403, "accessNotConfigured", "Gmail API has not been used in project 123 before or it is disabled."));
    const disabled = await email.sendEmail(base());
    expect((await row(disabled.id)).lastError).toContain("https://console.cloud.google.com/apis/library/gmail.googleapis.com");
    expect((await retryJob(disabled.id))?.status).toBe("pending");
    expect((await connection()).status).toBe("active");

    gmail.sendAnswers.push(h.gmailError(400, "invalidArgument", "Invalid To header"));
    const invalid = await email.sendEmail(base());
    const r = await row(invalid.id);
    expect(r.status).toBe("failed");
    expect(r.lastError).toMatch(/^permanent: Gmail refused to send this email \(400 invalidArgument\): Invalid To header/);
    expect(await retryJob(invalid.id)).toBeUndefined();
    expect(await email.retryEmailDelivery(invalid.id)).toBe("skipped");
  });
});

describe("held emails that are no longer useful", () => {
  it("gives up emails held over 24 hours, time sensitive ones, notices and meetings that started; sends the rest", async () => {
    await t.db.update(calendarConnections).set({ status: "needs_reauth" }).where(eq(calendarConnections.id, conn.id));
    const t0 = Date.parse("2030-03-04T10:00:00Z");
    setFakeNow(t0 - 25 * HOUR);
    const stale = await email.sendEmail(base());
    setFakeNow(t0);
    const { eventType } = await createEventType(t.db, { owner });
    const { scheduledEvent } = await createBooking(t.db, { eventType, start: new Date(t0 + 30 * MIN) });
    const meeting = await email.sendEmail(base({ related: { scheduledEventId: scheduledEvent.id } }));
    const reset = await email.sendEmail(base({ category: "auth", template: "auth.reset_password" }));
    const notice = await email.sendEmail(base({ category: "system", template: "calendar_connection_problem" }));
    const useful = await email.sendEmail(base());
    for (const r of [stale, meeting, reset, notice, useful]) expect(email.isHeldForGmail(await row(r.id))).toBe(true);
    expect(gmail.calls).toHaveLength(0);

    setFakeNow(t0 + HOUR);
    await h.reconnect(t.db, conn.id);
    await email.sweepStuckEmails();
    await runEmailJobs();
    expect(gmail.calls.map((c) => c.message.header("message-id"))).toEqual([email.outboxMessageId(useful.id)]);
    expect((await row(useful.id)).status).toBe("sent");
    expect((await row(stale.id)).lastError).toMatch(/^permanent: Not sent: Gmail could not send it within 24 hours\./);
    expect((await row(meeting.id)).lastError).toMatch(/^permanent: Not sent: the meeting started before Gmail could send it\./);
    expect((await row(reset.id)).lastError).toMatch(/^permanent: Not sent: it contained a code or link that expires within minutes/);
    expect((await row(notice.id)).lastError).toMatch(/^permanent: Not sent: this notice was out of date before Gmail could send it\./);
    for (const r of [stale, meeting, reset, notice]) expect((await row(r.id)).status).toBe("failed");
    expect(await email.countHeldEmails()).toBe(0);
  });

  it("a held email whose hold window ends without a reconnect is given up by its own job", async () => {
    await t.db.update(calendarConnections).set({ status: "needs_reauth" }).where(eq(calendarConnections.id, conn.id));
    const res = await email.sendEmail(base());
    setFakeNow(nowMs() + 25 * HOUR);
    await runEmailJobs();
    const r = await row(res.id);
    expect(r.status).toBe("failed");
    expect(r.lastError).toMatch(/^permanent: Not sent: Gmail could not send it within 24 hours\./);
    expect(gmail.calls).toHaveLength(0);
  });

  it("releases held emails to the outbox when the owner turns Gmail sending off", async () => {
    await t.db.update(calendarConnections).set({ status: "needs_reauth" }).where(eq(calendarConnections.id, conn.id));
    const res = await email.sendEmail(base());
    await t.db.insert(instanceSettings).values({ key: email.EMAIL_PROVIDER_SETTING_KEY, value: "outbox" });
    await email.sweepStuckEmails();
    await runEmailJobs();
    expect(await row(res.id)).toMatchObject({ status: "stored", provider: "outbox" });
    expect(gmail.calls).toHaveLength(0);
  });
});

describe("outbox link", () => {
  it("logs the email outbox page when an email is stored", async () => {
    await t.db.delete(calendarConnections).where(and(eq(calendarConnections.userId, owner.id)));
    env.LOG_LEVEL = "info";
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const res = await email.sendEmail(base());
    expect(res.status).toBe("stored");
    const stored = lines.map((l) => JSON.parse(l) as { event: string; outbox?: string }).find((l) => l.event === "email.stored");
    expect(stored?.outbox).toBe("http://localhost:3000/app/settings/email-outbox");
    expect(lines.join("\n")).not.toContain("/app/admin/outbox");
    expect(email.EMAIL_OUTBOX_PATH).toBe("/app/settings/email-outbox");
  });
});
