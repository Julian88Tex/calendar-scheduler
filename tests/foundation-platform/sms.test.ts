// SMS core (SPEC NT-16, GEN-15; ARCHITECTURE section 13.4): the SMS log, Twilio REST (mocked), opt-outs, unsupported
// countries, the anti pumping caps (10 per number per 24 hours, pause after 3 failures), retries and Twilio request
// signatures (Twilio's documented example).
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jobs, rateLimitBuckets, smsMessages, smsOptOuts } from "@/db/schema";
import {
  applySmsStatusCallback,
  normalizePhone,
  recordSmsOptOut,
  removeSmsOptOut,
  sendSms,
  smsKeyword,
  smsSegments,
  smsTransportName,
  twilioSignature,
  verifyTwilioSignature,
} from "@/lib/sms";
import { runDueJobs } from "@/lib/jobs";
import { resetFakeTime, setFakeNow } from "@/lib/time/now";
import { mockFetch, mockResponse, twilioRoutes, type FakeSms } from "../helpers/fake-providers";
import { useTestDb } from "../helpers/db";

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

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;
let n = 0;
const key = () => `sms:test:${++n}:${Math.random().toString(36).slice(2)}`;

const twilioOn = () => {
  env.TWILIO_ACCOUNT_SID = "ACtest";
  env.TWILIO_AUTH_TOKEN = "token";
  env.TWILIO_FROM_NUMBER = "+15005550006";
};

beforeEach(async () => {
  delete env.TWILIO_ACCOUNT_SID;
  delete env.TWILIO_AUTH_TOKEN;
  delete env.TWILIO_FROM_NUMBER;
  delete env.TWILIO_MESSAGING_SERVICE_SID;
  await t.db.delete(smsMessages);
  await t.db.delete(smsOptOuts);
  await t.db.delete(rateLimitBuckets);
  await t.db.delete(jobs);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetFakeTime();
  // process.env is shared with the other test files of this worker: leave nothing behind.
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_MESSAGING_SERVICE_SID"]) delete env[k];
});

describe("sendSms", () => {
  it("stores texts in the SMS log without Twilio, idempotently, with segments", async () => {
    expect(smsTransportName()).toBe("outbox");
    const k = key();
    const a = await sendSms({ to: "+1 (415) 555-0100", body: "Reminder: 30 Minute Meeting tomorrow at 10:00am", idempotencyKey: k });
    const b = await sendSms({ to: "+14155550100", body: "other", idempotencyKey: k });
    expect(a.status).toBe("stored");
    expect(b).toEqual({ id: a.id, status: "stored", reason: undefined });
    const [row] = await t.db.select().from(smsMessages).where(eq(smsMessages.id, a.id));
    expect(row).toMatchObject({ toNumber: "+14155550100", provider: "outbox", status: "stored", segments: 1 });
  });

  it("skips opted-out numbers with reason opted_out, and START removes the opt-out", async () => {
    await recordSmsOptOut("+14155550101", "stop");
    expect(await sendSms({ to: "+14155550101", body: "Hi", idempotencyKey: key() })).toMatchObject({ status: "skipped", reason: "opted_out" });
    await removeSmsOptOut("+14155550101");
    expect((await sendSms({ to: "+14155550101", body: "Hi", idempotencyKey: key() })).status).toBe("stored");
  });

  it("skips unsupported countries (+7, +65, +98)", async () => {
    for (const to of ["+74951234567", "+6561234567", "+982112345678"]) {
      expect(await sendSms({ to, body: "Hi", idempotencyKey: key() })).toMatchObject({ status: "skipped", reason: "unsupported_country" });
    }
  });

  it("the 11th text to one number within 24 hours is skipped with reason rate_limited; the window rolls", async () => {
    setFakeNow("2030-03-01T08:00:00Z");
    for (let i = 0; i < 10; i++) expect((await sendSms({ to: "+14155550102", body: `Text ${i}`, idempotencyKey: key() })).status).toBe("stored");
    expect(await sendSms({ to: "+14155550102", body: "Text 11", idempotencyKey: key() })).toMatchObject({ status: "skipped", reason: "rate_limited" });
    // Other numbers are unaffected.
    expect((await sendSms({ to: "+14155550103", body: "Hi", idempotencyKey: key() })).status).toBe("stored");
    // Still limited 20 hours later, allowed again after 25 hours.
    setFakeNow("2030-03-02T04:00:00Z");
    expect((await sendSms({ to: "+14155550102", body: "Later", idempotencyKey: key() })).reason).toBe("rate_limited");
    setFakeNow("2030-03-02T09:30:00Z");
    expect((await sendSms({ to: "+14155550102", body: "Next day", idempotencyKey: key() })).status).toBe("stored");
  });

  it("rejects invalid numbers and empty bodies", async () => {
    expect((await sendSms({ to: "4155550100", body: "Hi", idempotencyKey: key() })).status).toBe("failed");
    expect((await sendSms({ to: "+14155550104", body: "  ", idempotencyKey: key() })).status).toBe("failed");
  });
});

describe("Twilio transport", () => {
  it("sends through the Messages API with Basic auth and records the sid", async () => {
    twilioOn();
    const sent: FakeSms[] = [];
    const f = mockFetch(...twilioRoutes(sent));
    const res = await sendSms({ to: "+14155550110", body: "Reminder", idempotencyKey: key() });
    expect(res.status).toBe("sent");
    expect(sent).toEqual([expect.objectContaining({ to: "+14155550110", from: "+15005550006", body: "Reminder" })]);
    expect(f.calls[0]!.headers.get("authorization")).toBe(`Basic ${Buffer.from("ACtest:token").toString("base64")}`);
    const [row] = await t.db.select().from(smsMessages).where(eq(smsMessages.id, res.id));
    expect(row).toMatchObject({ status: "sent", provider: "twilio", providerSid: sent[0]!.sid, fromNumber: "+15005550006" });
  });

  it("uses the messaging service when configured", async () => {
    twilioOn();
    delete env.TWILIO_FROM_NUMBER;
    env.TWILIO_MESSAGING_SERVICE_SID = "MGservice";
    const sent: FakeSms[] = [];
    mockFetch(...twilioRoutes(sent));
    expect((await sendSms({ to: "+14155550111", body: "Hi", idempotencyKey: key() })).status).toBe("sent");
    expect(sent[0]).toMatchObject({ messagingServiceSid: "MGservice", from: undefined });
    delete env.TWILIO_MESSAGING_SERVICE_SID;
  });

  it("records an opt-out when Twilio reports the recipient unsubscribed (21610)", async () => {
    twilioOn();
    mockFetch({
      method: "POST",
      url: "https://api.twilio.com/",
      handler: () => mockResponse({ code: 21610, message: "Attempt to send to unsubscribed recipient", status: 400 }, { status: 400 }),
    });
    expect(await sendSms({ to: "+14155550112", body: "Hi", idempotencyKey: key() })).toMatchObject({ status: "skipped", reason: "opted_out" });
    expect(await t.db.select().from(smsOptOuts).where(eq(smsOptOuts.phone, "+14155550112"))).toHaveLength(1);
  });

  it("retries retryable errors with sms.retry and pauses a number after 3 failed deliveries", async () => {
    twilioOn();
    setFakeNow("2030-04-01T10:00:00Z");
    let fail = true;
    const sent: FakeSms[] = [];
    const ok = twilioRoutes(sent);
    mockFetch({
      method: "POST",
      url: "https://api.twilio.com/",
      handler: (req) =>
        fail ? mockResponse({ code: 20500, message: "Internal error", status: 500 }, { status: 500 }) : ok[0]!.handler(req),
    });
    const first = await sendSms({ to: "+14155550113", body: "One", idempotencyKey: key() });
    expect(first.status).toBe("failed");
    expect(await t.db.select().from(jobs).where(eq(jobs.type, "sms.retry"))).toHaveLength(1);
    await sendSms({ to: "+14155550113", body: "Two", idempotencyKey: key() });
    await sendSms({ to: "+14155550113", body: "Three", idempotencyKey: key() });
    expect(await sendSms({ to: "+14155550113", body: "Four", idempotencyKey: key() })).toMatchObject({ status: "skipped", reason: "rate_limited" });
    // A retry succeeds once Twilio recovers.
    fail = false;
    setFakeNow("2030-04-01T10:01:00Z");
    await runDueJobs({ budgetMs: 10_000, types: ["sms.retry"] });
    const [row] = await t.db.select().from(smsMessages).where(eq(smsMessages.id, first.id));
    expect(row).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("applies delivery status callbacks", async () => {
    twilioOn();
    const sent: FakeSms[] = [];
    mockFetch(...twilioRoutes(sent));
    const res = await sendSms({ to: "+14155550114", body: "Hi", idempotencyKey: key() });
    expect(await applySmsStatusCallback({ messageSid: sent[0]!.sid, messageStatus: "undelivered", errorCode: "30006" })).toBe(true);
    const [row] = await t.db.select().from(smsMessages).where(eq(smsMessages.id, res.id));
    expect(row).toMatchObject({ status: "failed" });
    expect(row!.lastError).toContain("30006");
    expect(await applySmsStatusCallback({ messageSid: "SMunknown", messageStatus: "delivered" })).toBe(false);
  });
});

describe("Twilio signatures", () => {
  // Twilio's documented example ("Validating Requests are coming from Twilio").
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };

  it("accepts Twilio's documented example and rejects a tampered parameter", () => {
    expect(twilioSignature("12345", url, params)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
    expect(verifyTwilioSignature({ url, params, signature: "0/KCTR6DLpKmkAf8muzZqo1nDgQ=", authToken: "12345" })).toBe(true);
    expect(verifyTwilioSignature({ url, params: { ...params, Digits: "1235" }, signature: "0/KCTR6DLpKmkAf8muzZqo1nDgQ=", authToken: "12345" })).toBe(false);
    expect(verifyTwilioSignature({ url, params, signature: "0/KCTR6DLpKmkAf8muzZqo1nDgQ=", authToken: "wrong" })).toBe(false);
    expect(verifyTwilioSignature({ url, params, signature: undefined, authToken: "12345" })).toBe(false);
  });

  it("tolerates a default port added or removed by a proxy", () => {
    const sig = twilioSignature("12345", url, params);
    expect(verifyTwilioSignature({ url: "https://mycompany.com:443/myapp.php?foo=1&bar=2", params, signature: sig, authToken: "12345" })).toBe(true);
    const sigWithPort = twilioSignature("12345", "https://mycompany.com:443/myapp.php?foo=1&bar=2", params);
    expect(verifyTwilioSignature({ url, params, signature: sigWithPort, authToken: "12345" })).toBe(true);
  });

  it("uses TWILIO_AUTH_TOKEN by default", () => {
    env.TWILIO_AUTH_TOKEN = "12345";
    expect(verifyTwilioSignature({ url, params, signature: "0/KCTR6DLpKmkAf8muzZqo1nDgQ=" })).toBe(true);
  });
});

describe("helpers", () => {
  it("counts segments for GSM-7 and UCS-2 bodies", () => {
    expect(smsSegments("a".repeat(160))).toMatchObject({ encoding: "GSM-7", segments: 1 });
    expect(smsSegments("a".repeat(161))).toMatchObject({ encoding: "GSM-7", segments: 2 });
    expect(smsSegments("€".repeat(80))).toMatchObject({ encoding: "GSM-7", units: 160, segments: 1 });
    expect(smsSegments("Привет".repeat(12))).toMatchObject({ encoding: "UCS-2", segments: 2 });
    expect(smsSegments("")).toMatchObject({ segments: 1 });
  });

  it("normalizes phone numbers and detects keywords", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("0044 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("020 7946 0958")).toBeNull();
    expect(normalizePhone("+0123")).toBeNull();
    expect(smsKeyword(" stop ")).toBe("opt_out");
    expect(smsKeyword("Unsubscribe please")).toBe("opt_out");
    expect(smsKeyword("START")).toBe("opt_in");
    expect(smsKeyword("help")).toBe("help");
    expect(smsKeyword("see you then")).toBeNull();
  });
});
