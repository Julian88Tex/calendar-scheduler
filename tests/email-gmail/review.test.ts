// Review regressions for the Gmail transport (PGlite, fake Gmail API):
// - a held email that fails with a retryable error after Gmail can send again is retried with backoff, not when its
//   24 hour hold job would run;
// - an earlier retryable failure waits for Gmail without spending a delivery attempt while the owner's connection
//   needs a reconnect (sendEmail with the same key, and the email.retry job);
// - held poll verification codes are given up after 10 minutes like booking codes;
// - held confirmations, updates and reminders of a meeting canceled meanwhile are given up, its cancellation is sent;
// - the From display name never carries control characters, and the outbox row records the name the message carries;
// - extra headers can never add recipients or replace the sender or the MIME structure.
import { eq } from "drizzle-orm";
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

const { calendarConnections, emailOutbox, instanceSettings, jobs, users } = await import("@/db/schema");
const email = await import("@/lib/email");
const { buildGmailMime } = await import("@/lib/email/gmail-mime");
const { runDueJobs } = await import("@/lib/jobs");
const { nowMs, resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { useTestDb } = await import("../helpers/db");
const { createBooking, createEventType, createUser } = await import("../factories");
const { parseMime } = await import("./mime");
const h = await import("./helpers");

type TestUser = Awaited<ReturnType<typeof createUser>>;

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;
const ENV_KEYS = ["RESEND_API_KEY", "SMTP_HOST", "EMAIL_PROVIDER", "EMAIL_FROM"];
const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.parse("2030-03-04T10:00:00Z");

let owner: TestUser;
let conn: Connection;
let gmail: FakeGmail;

const base = (over: Partial<Parameters<typeof email.sendEmail>[0]> = {}) => ({
  to: ["sam@example.com"],
  subject: "Confirmed: 30 Minute Meeting",
  html: "<p>Confirmed.</p>",
  text: "Confirmed.",
  template: "lifecycle.invitee_confirmation",
  category: "transactional" as const,
  idempotencyKey: `review:${Math.random().toString(36).slice(2)}`,
  ...over,
});

const row = async (id: string) => (await t.db.select().from(emailOutbox).where(eq(emailOutbox.id, id)))[0]!;
const retryJob = async (outboxId: string) => (await t.db.select().from(jobs).where(eq(jobs.idempotencyKey, `email.retry:${outboxId}`)))[0];
const runEmailJobs = () => runDueJobs({ budgetMs: 20_000, types: ["email.retry"], workerId: "test" });
const breakConnection = () => t.db.update(calendarConnections).set({ status: "needs_reauth" }).where(eq(calendarConnections.id, conn.id));

beforeAll(async () => {
  owner = await createUser(t.db, { name: "Jordan Lee", email: "jordan@example.com", isInstanceAdmin: true });
});

beforeEach(async () => {
  for (const k of ENV_KEYS) delete env[k];
  env.GOOGLE_CLIENT_ID = "google-client";
  env.GOOGLE_CLIENT_SECRET = "google-secret";
  setFakeNow(T0);
  await t.db.delete(emailOutbox);
  await t.db.delete(jobs);
  await t.db.delete(instanceSettings);
  await t.db.delete(calendarConnections).where(eq(calendarConnections.userId, owner.id));
  await t.db.update(users).set({ name: "Jordan Lee" }).where(eq(users.id, owner.id));
  conn = await h.connectGoogle(t.db, owner, { expiresAt: new Date(T0 + 72 * HOUR) });
  gmail = h.fakeGmail();
});

afterEach(() => {
  gmail.restore();
  vi.restoreAllMocks();
  resetFakeTime();
  for (const k of [...ENV_KEYS, "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) delete env[k];
});

describe("retry scheduling of emails that waited for Gmail", () => {
  it("a held email re-sent with its key after a reconnect and hit by a 503 is retried with backoff, not a day later", async () => {
    await breakConnection();
    const msg = base();
    const held = await email.sendEmail(msg);
    expect(email.isHeldForGmail(await row(held.id))).toBe(true);
    expect((await retryJob(held.id))!.runAt.getTime()).toBeGreaterThan(nowMs() + 23 * HOUR);

    await h.reconnect(t.db, conn.id);
    gmail.sendAnswers.push(h.gmailError(503, "backendError", "Backend Error"));
    const again = await email.sendEmail(msg);
    expect(again).toMatchObject({ id: held.id, status: "failed", deduplicated: true });
    expect((await row(held.id)).lastError).toMatch(/^gmail 503/);
    const job = (await retryJob(held.id))!;
    expect(job.status).toBe("pending");
    expect(job.runAt.getTime() - nowMs()).toBeLessThanOrEqual(5 * MIN);
    expect(job.maxAttempts - job.attempts).toBeGreaterThanOrEqual(email.EMAIL_MAX_ATTEMPTS - 1);

    setFakeNow(T0 + 10 * MIN);
    await runEmailJobs();
    expect(gmail.calls).toHaveLength(2);
    expect((await row(held.id)).status).toBe("sent");
  });

  it("an earlier retryable failure waits for Gmail without spending an attempt while the connection needs a reconnect", async () => {
    gmail.sendAnswers.push(h.gmailError(503, "backendError", "Backend Error"));
    const msg = base();
    const first = await email.sendEmail(msg);
    expect(await row(first.id)).toMatchObject({ status: "failed", attempts: 1 });

    await breakConnection();
    // sendEmail with the same key: held, no attempt counted, no call to Google.
    const again = await email.sendEmail(msg);
    expect(again).toMatchObject({ id: first.id, status: "failed", deduplicated: true });
    const held = await row(first.id);
    expect(email.isHeldForGmail(held)).toBe(true);
    expect(held.attempts).toBe(1);

    // A second row in the same situation, reached by its email.retry job instead.
    gmail.sendAnswers.length = 0;
    await h.reconnect(t.db, conn.id);
    gmail.sendAnswers.push(h.gmailError(503, "backendError", "Backend Error"));
    const other = await email.sendEmail(base());
    expect(await row(other.id)).toMatchObject({ status: "failed", attempts: 1 });
    await breakConnection();
    setFakeNow(T0 + 10 * MIN);
    await runEmailJobs();
    const otherRow = await row(other.id);
    expect(email.isHeldForGmail(otherRow)).toBe(true);
    expect(otherRow.attempts).toBe(1);
    expect(gmail.calls).toHaveLength(2);

    // After the reconnect both go out once.
    await h.reconnect(t.db, conn.id);
    await email.sweepStuckEmails();
    await runEmailJobs();
    expect((await row(first.id)).status).toBe("sent");
    expect((await row(other.id)).status).toBe("sent");
    expect(gmail.calls).toHaveLength(4);
  });
});

describe("held emails that are no longer useful", () => {
  it("gives up a held poll verification code after 10 minutes, like a booking code", async () => {
    await breakConnection();
    const poll = await email.sendEmail(base({ template: "polls.verification_code", category: "poll" }));
    const booking = await email.sendEmail(base({ template: "booking.verification_code" }));
    setFakeNow(T0 + 11 * MIN);
    await h.reconnect(t.db, conn.id);
    await email.sweepStuckEmails();
    await runEmailJobs();
    for (const id of [poll.id, booking.id]) {
      expect((await row(id)).lastError).toMatch(/^permanent: Not sent: it contained a code or link that expires within minutes/);
    }
    expect(gmail.calls).toHaveLength(0);
  });

  it("gives up confirmations and reminders of a meeting canceled meanwhile, and still sends its cancellation", async () => {
    const { eventType } = await createEventType(t.db, { owner });
    const { scheduledEvent } = await createBooking(t.db, { eventType, start: new Date(T0 + 48 * HOUR) });
    const related = { scheduledEventId: scheduledEvent.id };
    await breakConnection();
    const confirmation = await email.sendEmail(base({ related }));
    const hostNotice = await email.sendEmail(base({ related, template: "lifecycle.host_new_event", to: ["jordan@example.com"] }));
    const reminder = await email.sendEmail(base({ related, template: "workflows.invitee_reminder", category: "workflow" }));
    const canceled = await email.sendEmail(base({ related, template: "lifecycle.invitee_canceled", subject: "Canceled: 30 Minute Meeting" }));
    const rebook = await email.sendEmail(base({ related, template: "lifecycle.request_reschedule" }));
    const { scheduledEvents } = await import("@/db/schema");
    await t.db.update(scheduledEvents).set({ status: "canceled" }).where(eq(scheduledEvents.id, scheduledEvent.id));

    setFakeNow(T0 + HOUR);
    await h.reconnect(t.db, conn.id);
    await email.sweepStuckEmails();
    await runEmailJobs();
    for (const r of [confirmation, hostNotice, reminder]) {
      expect(await row(r.id)).toMatchObject({ status: "failed", lastError: expect.stringMatching(/^permanent: Not sent: the meeting was canceled before Gmail could send it\./) });
    }
    expect((await row(canceled.id)).status).toBe("sent");
    expect((await row(rebook.id)).status).toBe("sent");
    expect(gmail.calls.map((c) => c.message.header("message-id")).sort()).toEqual([email.outboxMessageId(canceled.id), email.outboxMessageId(rebook.id)].sort());
  });
});

describe("the From header", () => {
  it("removes control characters from the owner's name, and the outbox row records the name the message carries", async () => {
    await t.db.update(users).set({ name: "Jordan\r\nBcc: attacker@example.com" }).where(eq(users.id, owner.id));
    const res = await email.sendEmail(base());
    const m = gmail.calls[0]!.message;
    // One line, quoted (the name contains ":" and "@").
    expect(m.header("from")).toBe(`"Jordan Bcc: attacker@example.com" <${conn.address}>`);
    expect(m.header("bcc")).toBeNull();
    expect((await row(res.id)).fromName).toBe("Jordan Bcc: attacker@example.com");
  });

  it("is the bare Gmail address when the owner's name is blank, on the message and on the outbox row", async () => {
    await t.db.update(users).set({ name: "   " }).where(eq(users.id, owner.id));
    const res = await email.sendEmail(base());
    expect(gmail.calls[0]!.message.header("from")).toBe(conn.address);
    expect(await row(res.id)).toMatchObject({ fromName: null, fromAddress: conn.address, status: "sent" });
  });
});

describe("extra headers", () => {
  it("can never add recipients, replace the sender or change the MIME structure", async () => {
    const bytes = await buildGmailMime({
      msg: {
        from: { name: null, address: "ignored@example.com" },
        to: ["sam@example.com"],
        cc: [],
        bcc: [],
        replyTo: null,
        subject: "Hi",
        html: "<p>Hi</p>",
        text: "Hi",
        ics: null,
        attachments: [],
        headers: {
          "Auto-Submitted": "auto-generated",
          Bcc: "attacker@example.com",
          bcc: "attacker2@example.com",
          From: "evil@example.com",
          "Content-Type": "text/plain",
          "Message-ID": "<forged@example.com>",
          "X-Kairos-Test": "kept",
        },
        idempotencyKey: "k",
        tags: [],
      },
      from: { name: "Jordan Lee", address: "jordan.lee@gmail.com" },
      messageId: "<kairos-outbox-1@localhost>",
      date: new Date(T0),
    });
    const m = parseMime(bytes.toString("latin1"));
    expect(m.headerAll("bcc")).toEqual([]);
    expect(m.headerAll("from")).toEqual(["Jordan Lee <jordan.lee@gmail.com>"]);
    expect(m.headerAll("message-id")).toEqual(["<kairos-outbox-1@localhost>"]);
    expect(m.headerAll("content-type")).toHaveLength(1);
    expect(m.contentType).toBe("multipart/alternative");
    expect(m.header("auto-submitted")).toBe("auto-generated");
    expect(m.header("x-kairos-test")).toBe("kept");
  });

  it("job payload headers drop the reserved ones before any transport sees them", () => {
    expect(
      email.cleanHeaders({
        "List-Unsubscribe": "<https://x.test/u>",
        BCC: "attacker@example.com",
        "Reply-To": "attacker@example.com",
        "content-type": "text/plain",
        "X-Ok": "yes",
      }),
    ).toEqual({ "List-Unsubscribe": "<https://x.test/u>", "X-Ok": "yes" });
  });
});
