// Public booking endpoints (SPEC BK-31, BK-17, BK-18) through their route handlers on PGlite: the slots response
// shape grouped by the requested zone, no-store, troubleshoot for owners only, the 61st request per IP per minute
// answering 429, booking submissions with bot checks and same-origin protection, verification with the "Remember
// this device" cookie (embed-safe attributes), and the reservation status endpoint.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const { emailOutbox, invitees, jobs } = await import("@/db/schema");
const slotsRoute = await import("@/app/api/public/slots/route");
const bookingsRoute = await import("@/app/api/public/bookings/route");
const verifyRoute = await import("@/app/api/public/bookings/[reservationId]/verify/route");
const statusRoute = await import("@/app/api/public/bookings/[reservationId]/status/route");
const { issueBookingFormToken, publicSlots } = await import("@/lib/booking");
const { handlers } = await import("@/lib/booking/jobs");
const { log } = await import("@/lib/logger");
const { nowMs, resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { useTestDb } = await import("../helpers/db");
const h = await import("./helpers");
const { la, setupSolo, bookingInput } = h;

const t = useTestDb();
const NOW = la("2030-10-07 08:00");
let ipCounter = 0;
const freshIp = () => `203.0.113.${(ipCounter = (ipCounter + 1) % 250) + 1}`;

beforeEach(() => setFakeNow(NOW));
afterEach(() => resetFakeTime());

function slotsRequest(query: Record<string, string>, ip = freshIp()): Request {
  return new Request(`http://localhost:3000/api/public/slots?${new URLSearchParams(query)}`, { headers: { "x-forwarded-for": ip } });
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Request> {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": freshIp(), ...headers },
    body: JSON.stringify(body),
  });
}

describe("GET /api/public/slots", () => {
  it("returns the month grouped by the requested zone, no-store", async () => {
    const fx = await setupSolo(t.db);
    const res = await slotsRoute.GET(slotsRequest({ target: fx.target.eventType.id, start: "2030-10-01", end: "2030-10-31", tz: "Europe/Berlin" }), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = (await res.json()) as { timeZone: string; durationMinutes: number; days: Record<string, { start: string; remaining: number }[]>; firstAvailableDate?: string; windowEnd: string };
    expect(body.timeZone).toBe("Europe/Berlin");
    expect(body.durationMinutes).toBe(30);
    // Monday 15:00 PDT is already Tuesday 00:00 in Berlin; Tuesday's 16:30 PDT slot is 01:30 on Wednesday in Berlin.
    expect(body.days["2030-10-07"]?.[0]).toEqual({ start: "2030-10-07T16:00:00.000Z", remaining: 1 });
    expect(body.days["2030-10-08"]?.[0]).toEqual({ start: "2030-10-07T22:00:00.000Z", remaining: 1 });
    expect(body.days["2030-10-09"]?.some((s) => s.start === "2030-10-08T23:30:00.000Z")).toBe(true);
    expect(body.firstAvailableDate).toBe("2030-10-07");
    // Rolling 60 calendar days: same local time 60 days later (fake time keeps flowing during the test).
    expect(Math.abs(Date.parse(body.windowEnd) - la("2030-12-06 08:00").getTime())).toBeLessThan(10_000);
  });

  it("validates the query (zone, range of at most 62 days, unknown targets)", async () => {
    const fx = await setupSolo(t.db);
    const bad = await slotsRoute.GET(slotsRequest({ target: fx.target.eventType.id, start: "2030-10-01", end: "2030-12-31", tz: "UTC" }), undefined);
    expect(bad.status).toBe(400);
    const zone = await slotsRoute.GET(slotsRequest({ target: fx.target.eventType.id, start: "2030-10-01", end: "2030-10-02", tz: "Mars/Base" }), undefined);
    expect(zone.status).toBe(400);
    const missing = await slotsRoute.GET(slotsRequest({ target: "00000000-0000-4000-8000-000000000000", start: "2030-10-01", end: "2030-10-02", tz: "UTC" }), undefined);
    expect(missing.status).toBe(404);
  });

  it("looks ahead for the first available date when asked (first=1)", async () => {
    const fx = await setupSolo(t.db, { eventType: { dateRangeType: "unlimited" } });
    await h.updateEventType(t.db, fx.target.eventType.id, { minimumNoticeMinutes: 60 * 24 * 40 }); // 40 days of notice
    const res = await slotsRoute.GET(slotsRequest({ target: fx.target.eventType.id, start: "2030-10-01", end: "2030-10-31", tz: h.LA, first: "1" }), undefined);
    const body = (await res.json()) as { days: Record<string, unknown>; firstAvailableDate?: string };
    expect(body.days).toEqual({});
    expect(body.firstAvailableDate).toBe("2030-11-18");
  });

  it("troubleshoot=1 is for hosts only", async () => {
    const fx = await setupSolo(t.db);
    const q = { target: fx.target.eventType.id, start: "2030-10-08", end: "2030-10-08", tz: h.LA, troubleshoot: "1" as const };
    const res = await slotsRoute.GET(slotsRequest(q), undefined);
    expect(res.status).toBe(403);
    const owner = await publicSlots(q, { userId: fx.owner.id });
    const day = owner.troubleshoot!.days["2030-10-08"]!;
    expect(day.find((c) => c.status === "outside_hours")).toBeTruthy();
    expect(day.filter((c) => c.available)).toHaveLength(16);
  });

  it("answers 429 to the 61st request of an IP within a minute", async () => {
    const fx = await setupSolo(t.db);
    const q = { target: fx.target.eventType.id, start: "2031-06-01", end: "2031-06-30", tz: "UTC" }; // beyond the window: fast
    const ip = "198.51.100.7";
    for (let i = 0; i < 60; i++) {
      const res = await slotsRoute.GET(slotsRequest(q, ip), undefined);
      expect(res.status).toBe(200);
    }
    const limited = await slotsRoute.GET(slotsRequest(q, ip), undefined);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await slotsRoute.GET(slotsRequest(q, "198.51.100.8"), undefined)).status).toBe(200);
  });
});

describe("POST /api/public/bookings", () => {
  it("books with a valid form token and returns the invitee id", async () => {
    const fx = await setupSolo(t.db);
    const token = await issueBookingFormToken(nowMs() - 3_000);
    const res = await bookingsRoute.POST(await post("http://localhost:3000/api/public/bookings", { ...bookingInput(fx.target, la("2030-10-08 10:00")), formToken: token, website: "" }), undefined);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; inviteeId: string };
    expect(body.ok).toBe(true);
    expect((await t.db.select().from(invitees).where(eq(invitees.id, body.inviteeId))).length).toBe(1);
    // The same time again: slot_unavailable with the observed copy.
    const again = await bookingsRoute.POST(await post("http://localhost:3000/api/public/bookings", { ...bookingInput(fx.target, la("2030-10-08 10:00")), formToken: token }), undefined);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ ok: false, code: "slot_unavailable", message: "Sorry, that time is no longer available." });
  });

  it("rejects bots (honeypot, missing or too fresh form token) without creating anything (BK-18)", async () => {
    const fx = await setupSolo(t.db);
    const body = bookingInput(fx.target, la("2030-10-08 11:00"));
    const honeypot = await bookingsRoute.POST(await post("http://localhost:3000/api/public/bookings", { ...body, formToken: await issueBookingFormToken(nowMs() - 5_000), website: "http://spam" }), undefined);
    expect(honeypot.status).toBe(400);
    expect(await honeypot.json()).toMatchObject({ ok: false, code: "blocked" });
    const fast = await bookingsRoute.POST(await post("http://localhost:3000/api/public/bookings", { ...body, formToken: await issueBookingFormToken(nowMs() - 500) }), undefined);
    expect(fast.status).toBe(400);
    const none = await bookingsRoute.POST(await post("http://localhost:3000/api/public/bookings", body), undefined);
    expect(none.status).toBe(400);
    const forged = await bookingsRoute.POST(await post("http://localhost:3000/api/public/bookings", { ...body, formToken: `${nowMs() - 5_000}.${"0".repeat(32)}` }), undefined);
    expect(forged.status).toBe(400);
    expect(await t.db.select().from(invitees).where(eq(invitees.eventTypeId, fx.target.eventType.id))).toHaveLength(0);
  });

  it("refuses cross-site posts", async () => {
    const fx = await setupSolo(t.db);
    const res = await bookingsRoute.POST(await post("http://localhost:3000/api/public/bookings", bookingInput(fx.target, la("2030-10-08 11:00")), { origin: "https://evil.example" }), undefined);
    expect(res.status).toBe(403);
  });

  it("returns field errors for invalid input", async () => {
    const fx = await setupSolo(t.db, { questions: [h.DISCUSS] });
    const res = await bookingsRoute.POST(
      await post("http://localhost:3000/api/public/bookings", {
        ...bookingInput(fx.target, la("2030-10-08 11:00"), { invitee: { name: "", email: "x", timezone: "UTC" }, answers: [] }),
        formToken: await issueBookingFormToken(nowMs() - 3_000),
      }),
      undefined,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; fieldErrors: Record<string, string[]> };
    expect(body.code).toBe("validation");
    expect(body.fieldErrors.name).toEqual(["Can't be blank."]);
  });
});

describe("verification and status endpoints", () => {
  it("verifies the code, sets the remember-device cookie with embed-safe attributes and reports the status", async () => {
    const fx = await setupSolo(t.db, { eventType: { requireEmailVerification: true } });
    const res = await bookingsRoute.POST(
      await post("http://localhost:3000/api/public/bookings", {
        ...bookingInput(fx.target, la("2030-10-08 14:00"), { invitee: { name: "Ana", email: "ana@example.com", timezone: "UTC" } }),
        formToken: await issueBookingFormToken(nowMs() - 3_000),
        embed: true,
      }),
      undefined,
    );
    expect(res.status).toBe(202);
    const pending = (await res.json()) as { code: string; reservationId: string };
    expect(pending.code).toBe("verification_required");
    const statusCtx = { params: Promise.resolve({ reservationId: pending.reservationId }) };
    const st = await statusRoute.GET(new Request(`http://localhost:3000/api/public/bookings/${pending.reservationId}/status`), statusCtx);
    expect(await st.json()).toMatchObject({ status: "pending", kind: "email_verification", inviteeId: null });

    const [job] = await t.db.select().from(jobs).where(eq(jobs.type, "booking.send_verification_code"));
    await handlers["booking.send_verification_code"]!(job!.payload, { db: t.db, jobId: job!.id, attempt: 1, now: NOW, log });
    const [mail] = await t.db.select().from(emailOutbox).where(eq(emailOutbox.template, "booking.verification_code"));
    expect(mail!.toAddresses).toEqual(["ana@example.com"]);
    const code = mail!.subject.slice(0, 6);
    expect(mail!.text).toContain("This code expires in 10 minutes.");

    const ctx = { params: Promise.resolve({ reservationId: pending.reservationId }) };
    const wrong = await verifyRoute.POST(await post(`http://localhost:3000/api/public/bookings/${pending.reservationId}/verify`, { code: code === "000000" ? "999999" : "000000" }), ctx);
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ code: "invalid_code", message: "That code isn't correct. Try again." });
    const ok = await verifyRoute.POST(
      await post(`http://localhost:3000/api/public/bookings/${pending.reservationId}/verify`, { code, rememberDevice: true, embed: true }),
      { params: Promise.resolve({ reservationId: pending.reservationId }) },
    );
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as { ok: boolean; inviteeId: string; trustedDevice: { cookieName: string; value: string } };
    expect(okBody.ok).toBe(true);
    const cookie = ok.headers.get("set-cookie")!;
    expect(cookie).toContain(`kairos_trusted_device=${okBody.trustedDevice.value}`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=None/);
    expect(cookie).toMatch(/Partitioned/);
    expect(cookie).toMatch(/Secure/);
    const done = await statusRoute.GET(new Request("http://localhost:3000/x"), { params: Promise.resolve({ reservationId: pending.reservationId }) });
    expect(await done.json()).toMatchObject({ status: "completed", inviteeId: okBody.inviteeId });

    // The cookie (or its localStorage fallback header inside embeds) skips verification next time.
    const next = await bookingsRoute.POST(
      await post(
        "http://localhost:3000/api/public/bookings",
        { ...bookingInput(fx.target, la("2030-10-08 15:00"), { invitee: { name: "Ana", email: "ana@example.com", timezone: "UTC" } }), formToken: await issueBookingFormToken(nowMs() - 3_000) },
        { "x-kairos-fallback-kairos_trusted_device": okBody.trustedDevice.value },
      ),
      undefined,
    );
    expect(next.status).toBe(200);
    expect((await statusRoute.GET(new Request("http://localhost:3000/x"), { params: Promise.resolve({ reservationId: "not-a-uuid" }) })).status).toBe(404);
  });
});
