// Email core (SPEC GEN-15, NT-05, NT-20, ADM-04; ARCHITECTURE section 13.1): outbox, Resend and SMTP transports
// (mocked), idempotency, Reply-To handling, List-Unsubscribe headers, retries through email.retry and the layout.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const smtp = vi.hoisted(() => ({
  sent: [] as Record<string, unknown>[],
  fail: null as null | { responseCode?: number; code?: string; message: string },
  options: [] as Record<string, unknown>[],
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: (options: Record<string, unknown>) => {
      smtp.options.push(options);
      return {
        sendMail: async (mail: Record<string, unknown>) => {
          if (smtp.fail) throw Object.assign(new Error(smtp.fail.message), smtp.fail);
          smtp.sent.push(mail);
          return { messageId: `<msg-${smtp.sent.length}@smtp.test>` };
        },
      };
    },
  },
}));

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

const { emailOutbox, jobs } = await import("@/db/schema");
const email = await import("@/lib/email");
const { resetSmtpTransport } = await import("@/lib/email/transports");
const { runDueJobs } = await import("@/lib/jobs");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { mockFetch, mockResponse } = await import("../helpers/fake-providers");
const { useTestDb } = await import("../helpers/db");

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;

const base = (over: Partial<Parameters<typeof email.sendEmail>[0]> = {}) => ({
  to: ["invitee@example.com"],
  subject: "Confirmed: 30 Minute Meeting with Jordan Lee on Tuesday, October 20, 2026",
  html: "<p>Hi Sam,</p>",
  text: "Hi Sam,",
  template: "lifecycle.invitee_confirmation",
  category: "transactional" as const,
  idempotencyKey: `email:${Math.random().toString(36).slice(2)}`,
  ...over,
});

const row = async (id: string) => (await t.db.select().from(emailOutbox).where(eq(emailOutbox.id, id)))[0]!;

beforeEach(async () => {
  delete env.RESEND_API_KEY;
  delete env.SMTP_HOST;
  delete env.SMTP_PORT;
  delete env.SMTP_USER;
  delete env.SMTP_PASS;
  delete env.EMAIL_FROM;
  smtp.sent.length = 0;
  smtp.options.length = 0;
  smtp.fail = null;
  resetSmtpTransport();
  await t.db.delete(emailOutbox);
  await t.db.delete(jobs);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetFakeTime();
  // process.env is shared with the other test files of this worker: leave nothing behind.
  for (const k of ["RESEND_API_KEY", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"]) delete env[k];
  resetSmtpTransport();
});

describe("outbox transport (no provider configured)", () => {
  it("stores the message with its ICS and related records, idempotently by key", async () => {
    expect(email.emailTransportName()).toBe("outbox");
    const ics = email.buildIcs({
      method: "REQUEST",
      uid: "evt-1@localhost",
      sequence: 0,
      start: new Date("2026-10-20T14:00:00Z"),
      end: new Date("2026-10-20T14:30:00Z"),
      summary: "30 Minute Meeting with Jordan Lee",
      description: "",
      organizer: { name: "Jordan Lee", email: "jordan@example.com" },
      attendees: [{ name: "Sam Rivera", email: "invitee@example.com" }],
      status: "CONFIRMED",
    });
    const msg = base({
      replyTo: "jordan@example.com",
      fromName: "Jordan Lee via Kairos",
      ics: { method: "REQUEST", content: ics },
      related: { organizationId: "00000000-0000-4000-8000-000000000001", inviteeId: "00000000-0000-4000-8000-000000000002" },
    });
    const first = await email.sendEmail(msg);
    expect(first).toMatchObject({ status: "stored", deduplicated: false });
    const again = await email.sendEmail({ ...msg, subject: "Changed" });
    expect(again).toEqual({ id: first.id, status: "stored", deduplicated: true });
    const r = await row(first.id);
    expect(r).toMatchObject({
      status: "stored",
      provider: "outbox",
      subject: msg.subject,
      replyTo: "jordan@example.com",
      fromName: "Jordan Lee via Kairos",
      fromAddress: "notifications@localhost",
      icsMethod: "REQUEST",
      inviteeId: "00000000-0000-4000-8000-000000000002",
      organizationId: "00000000-0000-4000-8000-000000000001",
    });
    expect(r.ics).toContain("METHOD:REQUEST");
    expect(r.sentAt).toBeInstanceOf(Date);
    expect(await t.db.select().from(emailOutbox)).toHaveLength(1);
  });

  it("omits Reply-To when asked (NT-20 no-reply) and uses EMAIL_FROM for the sender", async () => {
    env.EMAIL_FROM = '"Acme Scheduling" <hello@acme.test>';
    const r = await row((await email.sendEmail(base({ replyTo: null }))).id);
    expect(r.replyTo).toBeNull();
    expect(r).toMatchObject({ fromAddress: "hello@acme.test", fromName: "Acme Scheduling" });
    expect(email.defaultFromAddress()).toBe('"Acme Scheduling" <hello@acme.test>');
  });

  it("drops invalid and duplicate recipients, strips header injection, and fails without any valid recipient", async () => {
    const ok = await email.sendEmail(
      base({ to: ["a@example.com", "A@example.com", "not an email"], cc: ["c@example.com"], subject: "Hi\r\nBcc: evil@x.test" }),
    );
    const r = await row(ok.id);
    expect(r.toAddresses).toEqual(["a@example.com"]);
    expect(r.ccAddresses).toEqual(["c@example.com"]);
    expect(r.subject).toBe("Hi Bcc: evil@x.test");
    expect(r.lastError).toContain("not an email");
    const bad = await email.sendEmail(base({ to: ["nope"] }));
    expect(bad).toMatchObject({ status: "failed", deduplicated: false });
    expect((await row(bad.id)).lastError).toContain("no valid recipients");
  });

  it("requires an idempotency key", async () => {
    await expect(email.sendEmail(base({ idempotencyKey: "" }))).rejects.toThrow(/idempotencyKey/);
  });
});

describe("Resend transport", () => {
  it("sends with the ICS attachment, headers, tags and the Resend idempotency key", async () => {
    env.RESEND_API_KEY = "re_test_key";
    const f = mockFetch({ method: "POST", url: "https://api.resend.com/emails", handler: () => ({ id: "re_123" }) });
    const res = await email.sendEmail(
      base({
        fromName: "Jordan Lee via Kairos",
        replyTo: "jordan@example.com",
        ics: { method: "CANCEL", content: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" },
        listUnsubscribe: { url: "https://app.example.com/api/public/polls/unsubscribe?t=abc", mailto: "unsubscribe@example.com" },
      }),
    );
    expect(res).toMatchObject({ status: "sent", deduplicated: false });
    expect(f.calls).toHaveLength(1);
    const call = f.calls[0]!;
    const body = call.body as Record<string, unknown> & { attachments: Record<string, unknown>[]; headers: Record<string, string> };
    expect(call.headers.get("authorization")).toBe("Bearer re_test_key");
    expect(call.headers.get("idempotency-key")).toBe(`kairos-outbox-${res.id}`);
    expect(body.from).toBe('"Jordan Lee via Kairos" <notifications@localhost>');
    expect(body.to).toEqual(["invitee@example.com"]);
    expect(body.reply_to).toBe("jordan@example.com");
    expect(body.headers["List-Unsubscribe"]).toBe(
      "<https://app.example.com/api/public/polls/unsubscribe?t=abc>, <mailto:unsubscribe@example.com>",
    );
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(body.headers["Auto-Submitted"]).toBe("auto-generated");
    expect(body.attachments).toEqual([
      {
        filename: "invite.ics",
        content: Buffer.from("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n").toString("base64"),
        content_type: "text/calendar; charset=utf-8; method=CANCEL",
      },
    ]);
    expect(body.tags).toEqual([
      { name: "category", value: "transactional" },
      { name: "template", value: "lifecycle_invitee_confirmation" },
    ]);
    expect(await row(res.id)).toMatchObject({ status: "sent", provider: "resend", providerMessageId: "re_123", attempts: 1 });
  });

  it("omits reply_to when replyTo is null", async () => {
    env.RESEND_API_KEY = "re_test_key";
    const f = mockFetch({ method: "POST", url: "https://api.resend.com/emails", handler: () => ({ id: "re_9" }) });
    await email.sendEmail(base({ replyTo: null }));
    expect((f.calls[0]!.body as Record<string, unknown>).reply_to).toBeUndefined();
  });

  it("retries a retryable failure through email.retry with backoff and then marks it sent", async () => {
    env.RESEND_API_KEY = "re_test_key";
    vi.spyOn(console, "error").mockImplementation(() => {});
    setFakeNow("2030-01-01T10:00:00Z");
    let fail = true;
    const f = mockFetch({
      method: "POST",
      url: "https://api.resend.com/emails",
      handler: () =>
        fail
          ? mockResponse({ name: "application_error", message: "Down", statusCode: 500 }, { status: 500 })
          : { id: "re_ok" },
    });
    const res = await email.sendEmail(base());
    expect(res.status).toBe("failed");
    expect(await row(res.id)).toMatchObject({ status: "failed", attempts: 1 });
    const [retry] = await t.db.select().from(jobs).where(eq(jobs.type, "email.retry"));
    expect(retry).toMatchObject({ idempotencyKey: `email.retry:${res.id}`, maxAttempts: 7, status: "pending" });
    expect(retry!.runAt.getTime() - Date.parse("2030-01-01T10:00:30Z")).toBeGreaterThanOrEqual(0);
    expect(retry!.runAt.getTime() - Date.parse("2030-01-01T10:00:30Z")).toBeLessThan(5_000);

    // Not due yet.
    expect((await runDueJobs({ budgetMs: 10_000, types: ["email.retry"] })).ran).toBe(0);
    setFakeNow("2030-01-01T10:01:00Z");
    // Still failing: the job is rescheduled with backoff.
    await runDueJobs({ budgetMs: 10_000, types: ["email.retry"] });
    expect((await t.db.select().from(jobs).where(eq(jobs.id, retry!.id)))[0]).toMatchObject({ status: "pending", attempts: 1 });
    expect(await row(res.id)).toMatchObject({ status: "failed", attempts: 2 });

    fail = false;
    setFakeNow("2030-01-01T10:05:00Z");
    await runDueJobs({ budgetMs: 10_000, types: ["email.retry"] });
    expect(await row(res.id)).toMatchObject({ status: "sent", providerMessageId: "re_ok", attempts: 3, lastError: null });
    expect((await t.db.select().from(jobs).where(eq(jobs.id, retry!.id)))[0]?.status).toBe("succeeded");
    expect(f.calls).toHaveLength(3);
    // The retry used the same per-row provider idempotency key.
    expect(new Set(f.calls.map((c) => c.headers.get("idempotency-key")))).toEqual(new Set([`kairos-outbox-${res.id}`]));
  });

  it("marks permanent rejections failed without a retry, and a repeated send does not retry them", async () => {
    env.RESEND_API_KEY = "re_test_key";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = mockFetch({
      method: "POST",
      url: "https://api.resend.com/emails",
      handler: () => mockResponse({ name: "validation_error", message: "Invalid `to` field", statusCode: 422 }, { status: 422 }),
    });
    const msg = base();
    const res = await email.sendEmail(msg);
    expect(res.status).toBe("failed");
    expect((await row(res.id)).lastError).toMatch(/^permanent: resend validation_error/);
    expect(await t.db.select().from(jobs).where(eq(jobs.type, "email.retry"))).toHaveLength(0);
    expect(await email.sendEmail(msg)).toEqual({ id: res.id, status: "failed", deduplicated: true });
    expect(f.calls).toHaveLength(1);
  });

  it("re-attempts a failed row when the same message is sent again", async () => {
    env.RESEND_API_KEY = "re_test_key";
    vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    mockFetch({
      method: "POST",
      url: "https://api.resend.com/emails",
      handler: () => (fail ? mockResponse({ name: "rate_limit_exceeded", message: "Slow down", statusCode: 429 }, { status: 429 }) : { id: "re_2" }),
    });
    const msg = base();
    expect((await email.sendEmail(msg)).status).toBe("failed");
    fail = false;
    expect(await email.sendEmail(msg)).toMatchObject({ status: "sent", deduplicated: true });
    // The pending email.retry job becomes a no-op.
    await runDueJobs({ budgetMs: 10_000, types: ["email.retry"] });
    const all = await t.db.select().from(emailOutbox);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: "sent", attempts: 2 });
  });
});

describe("SMTP transport", () => {
  it("sends the ICS as a text/calendar alternative plus attachment (nodemailer icalEvent) with headers", async () => {
    env.SMTP_HOST = "smtp.example.test";
    env.SMTP_PORT = "465";
    env.SMTP_USER = "user";
    env.SMTP_PASS = "pass";
    expect(email.emailTransportName()).toBe("smtp");
    const res = await email.sendEmail(
      base({
        replyTo: "jordan@example.com",
        fromName: "Jordan Lee via Kairos",
        ics: { method: "REQUEST", content: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" },
        attachments: [{ filename: "notes.txt", contentType: "text/plain", content: "hello" }],
        listUnsubscribe: { url: "https://app.example.com/u" },
      }),
    );
    expect(res).toMatchObject({ status: "sent" });
    expect(smtp.options[0]).toMatchObject({ host: "smtp.example.test", port: 465, secure: true, auth: { user: "user", pass: "pass" } });
    const mail = smtp.sent[0]!;
    expect(mail).toMatchObject({
      from: { name: "Jordan Lee via Kairos", address: "notifications@localhost" },
      to: ["invitee@example.com"],
      replyTo: "jordan@example.com",
      icalEvent: { method: "REQUEST", filename: "invite.ics", content: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" },
      attachments: [{ filename: "notes.txt", content: Buffer.from("hello").toString("base64"), encoding: "base64", contentType: "text/plain" }],
    });
    expect((mail.headers as Record<string, string>)["List-Unsubscribe"]).toBe("<https://app.example.com/u>");
    expect((mail.headers as Record<string, string>)["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(await row(res.id)).toMatchObject({ status: "sent", provider: "smtp", providerMessageId: "<msg-1@smtp.test>" });
  });

  it("classifies 55x mailbox errors as permanent and connection errors as retryable", async () => {
    env.SMTP_HOST = "smtp.example.test";
    smtp.fail = { responseCode: 550, message: "Mailbox unavailable" };
    const perm = await email.sendEmail(base());
    expect((await row(perm.id)).lastError).toMatch(/^permanent: smtp 550/);
    smtp.fail = { code: "ECONNREFUSED", message: "connect ECONNREFUSED" };
    const temp = await email.sendEmail(base());
    expect((await row(temp.id)).lastError).toMatch(/^smtp ECONNREFUSED/);
    expect(await t.db.select().from(jobs).where(eq(jobs.type, "email.retry"))).toHaveLength(1);
  });
});

describe("resend from the outbox and interrupted deliveries", () => {
  it("resendOutboxEmail sends a fresh copy, and refuses purged bodies", async () => {
    const first = await email.sendEmail(base({ attachments: [{ filename: "a.txt", contentType: "text/plain", content: "x" }] }));
    const copy = await email.resendOutboxEmail(first.id);
    expect(copy.id).not.toBe(first.id);
    const r = await row(copy.id);
    expect(r).toMatchObject({ subject: (await row(first.id)).subject, status: "stored" });
    expect(r.attachments[0]).toMatchObject({ filename: "a.txt", contentBase64: Buffer.from("x").toString("base64") });
    await t.db.update(emailOutbox).set({ bodyPurgedAt: new Date(), html: "", text: "" }).where(eq(emailOutbox.id, first.id));
    await expect(email.resendOutboxEmail(first.id)).rejects.toThrow("Content removed after 30 days");
  });

  it("the periodic sweep re-sends rows left in sending by a killed function", async () => {
    env.RESEND_API_KEY = "re_test_key";
    const f = mockFetch({ method: "POST", url: "https://api.resend.com/emails", handler: () => ({ id: "re_sweep" }) });
    setFakeNow("2030-02-01T10:00:00Z");
    const [stuck] = await t.db
      .insert(emailOutbox)
      .values({
        toAddresses: ["x@example.com"],
        fromAddress: "notifications@localhost",
        subject: "Stuck",
        html: "<p>x</p>",
        text: "x",
        template: "t",
        category: "system",
        status: "sending",
        provider: "resend",
        attempts: 1,
        idempotencyKey: "stuck-1",
        updatedAt: new Date("2030-02-01T09:00:00Z"),
      })
      .returning();
    expect(await email.sweepStuckEmails()).toBe(1);
    expect(await row(stuck!.id)).toMatchObject({ status: "sent", attempts: 2 });
    expect(f.calls).toHaveLength(1);
  });
});

describe("List-Unsubscribe headers", () => {
  it("adds one-click headers only for absolute URLs", () => {
    expect(email.listUnsubscribeHeaders({ url: "https://x.test/u?a=1" })).toEqual({
      "List-Unsubscribe": "<https://x.test/u?a=1>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(email.listUnsubscribeHeaders({ url: "/relative" })).toEqual({});
    expect(email.listUnsubscribeHeaders(null)).toEqual({});
  });
});

describe("delivery robustness under serverless (review regressions)", () => {
  const insertRow = async (over: Partial<typeof emailOutbox.$inferInsert> = {}) =>
    (
      await t.db
        .insert(emailOutbox)
        .values({
          toAddresses: ["x@example.com"],
          fromAddress: "notifications@localhost",
          subject: "Row",
          html: "<p>x</p>",
          text: "x",
          template: "t",
          category: "poll",
          status: "failed",
          provider: "resend",
          attempts: 2,
          lastError: "resend application_error (500): Down",
          idempotencyKey: `row-${Math.random().toString(36).slice(2)}`,
          updatedAt: new Date("2030-03-01T09:00:00Z"),
          ...over,
        })
        .returning()
    )[0]!;

  it("a failed row whose earlier retry job already finished still gets a retry (the job is revived)", async () => {
    env.RESEND_API_KEY = "re_test_key";
    vi.spyOn(console, "error").mockImplementation(() => {});
    setFakeNow("2030-03-01T10:00:00Z");
    mockFetch({
      method: "POST",
      url: "https://api.resend.com/emails",
      handler: () => mockResponse({ name: "application_error", message: "Down", statusCode: 500 }, { status: 500 }),
    });
    const r = await insertRow();
    // The row's retry job finished earlier (for example it ran while another worker held the row and was killed).
    const [old] = await t.db
      .insert(jobs)
      .values({
        type: "email.retry",
        payload: { outboxId: r.id, headers: { "List-Unsubscribe": "<https://x.test/u>" } },
        runAt: new Date("2030-03-01T08:00:00Z"),
        status: "succeeded",
        attempts: 1,
        idempotencyKey: `email.retry:${r.id}`,
        finishedAt: new Date("2030-03-01T08:00:01Z"),
      })
      .returning();
    expect(await email.sweepStuckEmails()).toBe(1);
    expect(await row(r.id)).toMatchObject({ status: "failed", attempts: 3 });
    const [revived] = await t.db.select().from(jobs).where(eq(jobs.id, old!.id));
    expect(revived).toMatchObject({ status: "pending", attempts: 0, maxAttempts: 5, finishedAt: null });
    expect(revived!.runAt.getTime()).toBeGreaterThan(Date.parse("2030-03-01T10:00:00Z"));
    // The revived job keeps the first delivery's headers.
    expect((revived!.payload as { headers: Record<string, string> }).headers["List-Unsubscribe"]).toBe("<https://x.test/u>");
    // A pending retry job means the sweep leaves the row to it.
    expect(await email.sweepStuckEmails()).toBe(0);
  });

  it("re-sends carry the first delivery's List-Unsubscribe headers (recovered from the retry job)", async () => {
    env.RESEND_API_KEY = "re_test_key";
    setFakeNow("2030-03-01T10:00:00Z");
    const f = mockFetch({ method: "POST", url: "https://api.resend.com/emails", handler: () => ({ id: "re_lu" }) });
    const r = await insertRow({ status: "sending", attempts: 1, lastError: null });
    await t.db.insert(jobs).values({
      type: "email.retry",
      payload: { outboxId: r.id, headers: { "List-Unsubscribe": "<https://x.test/u>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } },
      runAt: new Date("2030-03-01T08:00:00Z"),
      status: "dead",
      idempotencyKey: `email.retry:${r.id}`,
    });
    expect(await email.sweepStuckEmails()).toBe(1);
    expect(await row(r.id)).toMatchObject({ status: "sent", providerMessageId: "re_lu" });
    const headers = (f.calls[0]!.body as { headers: Record<string, string> }).headers;
    expect(headers).toMatchObject({
      "Auto-Submitted": "auto-generated",
      "List-Unsubscribe": "<https://x.test/u>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("a retry job that finds the row mid-delivery elsewhere backs off without spending an attempt", async () => {
    env.RESEND_API_KEY = "re_test_key";
    setFakeNow("2030-03-01T10:00:00Z");
    const f = mockFetch({ method: "POST", url: "https://api.resend.com/emails", handler: () => ({ id: "re_x" }) });
    const r = await insertRow({ status: "sending", attempts: 2, updatedAt: new Date("2030-03-01T09:58:00Z") });
    const jobId = (await (await import("@/lib/jobs")).enqueueJob(t.db, {
      type: "email.retry",
      payload: { outboxId: r.id },
      idempotencyKey: `email.retry:${r.id}`,
    }))!;
    await runDueJobs({ budgetMs: 10_000, types: ["email.retry"] });
    const [job] = await t.db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(job).toMatchObject({ status: "pending", attempts: 0 });
    expect(job!.runAt.getTime()).toBeGreaterThanOrEqual(Date.parse("2030-03-01T10:10:00Z"));
    expect(f.calls).toHaveLength(0);
    // Once the delivery counts as interrupted, the job takes the row over and sends it.
    setFakeNow("2030-03-01T10:12:00Z");
    await runDueJobs({ budgetMs: 10_000, types: ["email.retry"] });
    expect(await row(r.id)).toMatchObject({ status: "sent", attempts: 3 });
    expect((await t.db.select().from(jobs).where(eq(jobs.id, jobId)))[0]?.status).toBe("succeeded");
  });

  it("never exceeds 8 delivery attempts per email", async () => {
    env.RESEND_API_KEY = "re_test_key";
    setFakeNow("2030-03-01T10:00:00Z");
    const f = mockFetch({ method: "POST", url: "https://api.resend.com/emails", handler: () => ({ id: "re_never" }) });
    const exhausted = await insertRow({ attempts: email.EMAIL_MAX_ATTEMPTS });
    const interrupted = await insertRow({ status: "sending", attempts: email.EMAIL_MAX_ATTEMPTS, lastError: null });
    expect(await email.retryEmailDelivery(exhausted.id)).toBe("failed");
    expect((await row(exhausted.id)).lastError).toMatch(/^permanent: gave up after 8 attempts/);
    // The sweep gives up on the interrupted last attempt instead of trying a ninth time.
    await email.sweepStuckEmails();
    expect(await row(interrupted.id)).toMatchObject({ status: "failed", attempts: 8 });
    expect((await row(interrupted.id)).lastError).toMatch(/^permanent: gave up/);
    expect(f.calls).toHaveLength(0);
  });

  it("Resend's idempotent payload mismatch means an earlier attempt was accepted: the row is sent, not failed", async () => {
    env.RESEND_API_KEY = "re_test_key";
    setFakeNow("2030-03-01T10:00:00Z");
    mockFetch({
      method: "POST",
      url: "https://api.resend.com/emails",
      handler: () =>
        mockResponse(
          { name: "invalid_idempotent_request", message: "Same idempotency key used with a different request payload", statusCode: 409 },
          { status: 409 },
        ),
    });
    const r = await insertRow({ status: "sending", attempts: 1, lastError: null });
    expect(await email.sweepStuckEmails()).toBe(1);
    expect(await row(r.id)).toMatchObject({ status: "sent", lastError: null });
    expect(await t.db.select().from(jobs).where(eq(jobs.type, "email.retry"))).toHaveLength(0);
  });

  it("stores the ICS method of the document itself (a mismatched method never turns a cancel into an invite)", async () => {
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "METHOD:CANCEL", "BEGIN:VEVENT", "UID:x@localhost", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
    const res = await email.sendEmail(base({ ics: { method: "REQUEST", content: ics } }));
    expect(await row(res.id)).toMatchObject({ icsMethod: "CANCEL", ics });
    expect(email.icsMethodOf(ics)).toBe("CANCEL");
    expect(email.icsMethodOf("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")).toBeNull();
    // An empty ICS is dropped.
    const none = await email.sendEmail(base({ ics: { method: "REQUEST", content: "  " } }));
    expect(await row(none.id)).toMatchObject({ icsMethod: null, ics: null });
  });

  it("cleans header maps from job payloads", () => {
    expect(email.cleanHeaders({ "X-Ok": "a\r\nBcc: evil@x.test", "Bad Name": "x", Num: 1, "List-Unsubscribe": "<https://x.test/u>" })).toEqual({
      "X-Ok": "a Bcc: evil@x.test",
      "List-Unsubscribe": "<https://x.test/u>",
    });
    expect(email.cleanHeaders(null)).toEqual({});
    expect(email.cleanHeaders(["x"])).toEqual({});
  });
});
