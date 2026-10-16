// BK-31 acceptance on the seeded owner data (scripts/seed-scenarios.ts): the slots endpoint returns exactly the slots
// the pure engine computes from the same fixtures (owner's "Working hours" and "Block Off Work" schedules, 15 minute
// increments, 15/15 buffers, 4 hours notice, 60 rolling days), and the observed owner case holds: the 120 minute
// meal on Tuesday 17:00 to 20:00 Los Angeles offers 17:00, 17:15, ..., 18:00.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

const { eventTypes } = await import("@/db/schema");
const slotsRoute = await import("@/app/api/public/slots/route");
const { computeSlots } = await import("@/lib/slots");
const { host, rules } = await import("@/lib/slots/testing");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { runSeed } = await import("../../scripts/seed-scenarios.ts");
const { OWNER_SCHEDULES, OWNER_EVENT_TYPES } = await import("../../scripts/seed-data.ts");
const { useTestDb } = await import("../helpers/db");
const h = await import("./helpers");

const t = useTestDb();
const NOW = h.la("2030-10-07 06:00"); // Monday 06:00 Los Angeles
let seeded: Awaited<ReturnType<typeof runSeed>>;

beforeAll(async () => {
  setFakeNow(NOW);
  seeded = await runSeed(t.db, { scenario: "owner", demo: false });
});
afterAll(() => resetFakeTime());

async function apiStarts(slug: string, start: string, end: string): Promise<string[]> {
  const id = seeded.owner!.eventTypeIds[slug]!;
  const res = await slotsRoute.GET(
    new Request(`http://localhost:3000/api/public/slots?${new URLSearchParams({ target: id, start, end, tz: h.LA })}`, { headers: { "x-forwarded-for": "192.0.2.50" } }),
    undefined,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { days: Record<string, { start: string }[]> };
  return Object.values(body.days).flat().map((s) => s.start);
}

function engineStarts(slug: string, start: string, end: string, nowMs: number): string[] {
  const spec = OWNER_EVENT_TYPES.find((e) => e.slug === slug)!;
  const schedule = OWNER_SCHEDULES.find((s) => s.key === spec.schedule)!;
  const range = { start: h.la(`${start} 00:00`).getTime(), end: new Date(h.la(`${end} 00:00`).getTime() + 24 * 3_600_000).getTime() };
  const result = computeSlots({
    rules: rules({
      durationMinutes: spec.durationMinutes,
      incrementMinutes: spec.slotIncrementMinutes,
      bufferBeforeMinutes: spec.bufferBeforeMinutes,
      bufferAfterMinutes: spec.bufferAfterMinutes,
      minimumNoticeMinutes: 240,
      dateRange: { type: "rolling", days: 60, mode: "calendar_days" },
      rangeZone: h.LA,
    }),
    hosts: [host("owner", { schedule: { timeZone: h.LA, weekly: schedule.weeklyHours, overrides: {}, blockedDates: [] }, hostLimitZone: h.LA })],
    query: { rangeStart: range.start, rangeEnd: range.end, now: nowMs },
  });
  return result.slots.map((s) => new Date(s.start).toISOString());
}

describe("slots endpoint on the seeded owner (BK-31)", () => {
  it("returns identical slots to the engine fixtures for every seeded event type", async () => {
    for (const slug of ["30min", "60min", "meal"]) {
      const api = await apiStarts(slug, "2030-10-07", "2030-10-20");
      // The request's own clock is the fake now (plus milliseconds of test time): compare with the same instant.
      const engine = engineStarts(slug, "2030-10-07", "2030-10-20", NOW.getTime() + 1_000);
      expect(api.length).toBeGreaterThan(10);
      expect(api).toEqual(engine);
    }
  });

  it("offers 17:00 to 18:00 every 15 minutes for the 120 minute meal on a Tuesday", async () => {
    const api = await apiStarts("meal", "2030-10-08", "2030-10-08");
    expect(api.map((s) => h.laTime(Date.parse(s)))).toEqual(["17:00", "17:15", "17:30", "17:45", "18:00"]);
    const [meal] = await t.db.select().from(eventTypes).where(eq(eventTypes.id, seeded.owner!.eventTypeIds.meal!));
    expect(meal!.scheduleId).toBe(seeded.owner!.scheduleIds.block_off_work);
  });
});
