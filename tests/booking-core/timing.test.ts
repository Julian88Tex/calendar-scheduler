// GEN-07 performance budgets on PGlite with stub providers: a month of slots for the seeded owner setup (Working
// hours, 15 minute increments, 15/15 buffers, meetings and cached calendar events) answers in under 800ms p95 over
// 50 requests, and a booking submission completes in under 2 seconds p95.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ExternalBusy } from "@/lib/calendars";

const cal = vi.hoisted(() => ({ busy: {} as Record<string, ExternalBusy[]> }));
vi.mock("@/lib/calendars", () => ({
  // Cached calendar data: answered from memory like a warm busy cache.
  getExternalBusy: async (p: { userIds: string[] }) => Object.fromEntries(p.userIds.map((id) => [id, { ok: true, stale: false, nocal: false, busy: cal.busy[id] ?? [] }])),
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

const slotsRoute = await import("@/app/api/public/slots/route");
const bookingsRoute = await import("@/app/api/public/bookings/route");
const { issueBookingFormToken } = await import("@/lib/booking");
const { nowMs, resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const f = await import("../factories");
const { useTestDb } = await import("../helpers/db");
const h = await import("./helpers");
const { la, ext } = h;
const { OWNER_SCHEDULES } = await import("../../scripts/seed-data.ts");

const t = useTestDb();
const NOW = la("2030-10-01 08:00");

const p95 = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
};

let fx: Awaited<ReturnType<typeof h.setupSolo>>;

beforeAll(async () => {
  setFakeNow(NOW);
  fx = await h.setupSolo(t.db, {
    weeklyHours: OWNER_SCHEDULES[0]!.weeklyHours,
    questions: [h.DISCUSS],
    eventType: { slotIncrementMinutes: 15, bufferBeforeMinutes: 15, bufferAfterMinutes: 15, minimumNoticeMinutes: 240, limitPerDay: 8 },
    user: { meetingLimitDay: 10, meetingLimitWeek: 40 },
  });
  // About one meeting per weekday and three calendar events per day in October.
  for (let d = 1; d <= 31; d++) {
    const date = `2030-10-${String(d).padStart(2, "0")}`;
    if (d % 7 !== 5) await f.createBooking(t.db, { eventType: fx.target.eventType, start: la(`${date} 12:00`) });
  }
  const busy: ExternalBusy[] = [];
  for (let d = 1; d <= 31; d++) {
    const date = `2030-10-${String(d).padStart(2, "0")}`;
    busy.push(ext(la(`${date} 08:00`), la(`${date} 09:30`), "Gym"));
    busy.push(ext(la(`${date} 14:00`), la(`${date} 14:45`), "Call"));
    busy.push(ext(la(`${date} 18:00`), la(`${date} 19:00`), "Dinner"));
  }
  cal.busy[fx.owner.id] = busy;
});
afterAll(() => resetFakeTime());

describe("GEN-07 performance budgets", () => {
  it("serves a month of slots in under 800ms p95 over 50 requests", async () => {
    const samples: number[] = [];
    let total = 0;
    for (let i = 0; i < 50; i++) {
      const req = new Request(
        `http://localhost:3000/api/public/slots?${new URLSearchParams({ target: fx.target.eventType.id, start: "2030-10-01", end: "2030-10-31", tz: "America/New_York" })}`,
        { headers: { "x-forwarded-for": `192.0.2.${(i % 200) + 1}` } },
      );
      const started = performance.now();
      const res = await slotsRoute.GET(req, undefined);
      const body = (await res.json()) as { days: Record<string, unknown[]> };
      samples.push(performance.now() - started);
      expect(res.status).toBe(200);
      total = Object.values(body.days).reduce((n, list) => n + list.length, 0);
    }
    expect(total).toBeGreaterThan(100);
    expect(p95(samples)).toBeLessThan(800);
  });

  it("completes a booking submission in under 2 seconds p95", async () => {
    const samples: number[] = [];
    const starts = ["2030-10-14", "2030-10-15", "2030-10-16", "2030-10-17", "2030-10-18", "2030-10-21", "2030-10-22", "2030-10-23", "2030-10-24", "2030-10-25"];
    for (const [i, date] of starts.entries()) {
      for (const time of ["13:00", "15:30"]) {
        const body = {
          ...h.bookingInput(fx.target, la(`${date} ${time}`)),
          formToken: await issueBookingFormToken(nowMs() - 3_000),
          clientRequestId: `timing-${i}-${time}`,
        };
        const req = new Request("http://localhost:3000/api/public/bookings", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": `198.18.0.${i * 2 + (time === "13:00" ? 1 : 2)}` },
          body: JSON.stringify(body),
        });
        const started = performance.now();
        const res = await bookingsRoute.POST(req, undefined);
        samples.push(performance.now() - started);
        expect(res.status).toBe(200);
      }
    }
    expect(p95(samples)).toBeLessThan(2_000);
  });
});
