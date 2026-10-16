// Booking-core public endpoints in the real Next server (SPEC BK-31, BK-18, BK-24): the slots month for the seeded
// owner grouped by the requested zone with no-store, the owner-only troubleshoot mode, input validation, the 61st
// request per IP per minute answering 429, and booking submissions refusing bots and cross-site posts.
import { expect, test } from "../fixtures";

type Seeded = { owner: { userId: string; slug: string; email: string; eventTypeIds: Record<string, string> } };
type SlotsBody = {
  timeZone: string;
  durationMinutes: number;
  days: Record<string, { start: string; remaining: number }[]>;
  firstAvailableDate?: string;
  windowEnd: string | null;
  troubleshoot?: { days: Record<string, { start: number; status: string; reasons: string[] }[]> };
};

test.describe("booking-core public API", () => {
  let seeded: Seeded;

  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await api.setTime("2030-10-07T13:00:00Z"); // Monday 06:00 in Los Angeles
    seeded = (await seed("owner")) as unknown as Seeded;
  });

  test.afterEach(async ({ api }) => {
    await api.setTime(null);
  });

  test("serves the month of slots grouped by the invitee zone", async ({ request }) => {
    const id = seeded.owner.eventTypeIds["30min"]!;
    const res = await request.get(`/api/public/slots?target=${id}&start=2030-10-01&end=2030-10-31&tz=America/New_York`, {
      headers: { "x-forwarded-for": "203.0.113.10" },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = (await res.json()) as SlotsBody;
    expect(body.timeZone).toBe("America/New_York");
    expect(body.durationMinutes).toBe(30);
    // Monday Oct 7: Working hours 12:00 to 17:00 Pacific with 4 hours notice from 06:00: first start 12:00 Pacific
    // (15:00 in New York), 15 minute increments, last start 16:30 Pacific.
    expect(body.days["2030-10-07"]?.[0]).toEqual({ start: "2030-10-07T19:00:00.000Z", remaining: 1 });
    expect(body.days["2030-10-07"]?.at(-1)?.start).toBe("2030-10-07T23:30:00.000Z");
    expect(body.firstAvailableDate).toBe("2030-10-07");
    // Saturdays have no hours.
    expect(body.days["2030-10-12"]).toBeUndefined();
  });

  test("troubleshoot mode is for the owner only", async ({ request, page, loginAs }) => {
    const id = seeded.owner.eventTypeIds["30min"]!;
    const url = `/api/public/slots?target=${id}&start=2030-10-08&end=2030-10-08&tz=America/Los_Angeles&troubleshoot=1`;
    expect((await request.get(url, { headers: { "x-forwarded-for": "203.0.113.11" } })).status()).toBe(403);
    await loginAs(page, seeded.owner.email);
    const res = await page.context().request.get(url, { headers: { "x-forwarded-for": "203.0.113.12" } });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as SlotsBody;
    const day = body.troubleshoot!.days["2030-10-08"]!;
    expect(day.some((c) => c.status === "available")).toBe(true);
    expect(day.some((c) => c.status === "outside_hours")).toBe(true);
  });

  test("validates the query and limits each IP to 60 requests per minute", async ({ request }) => {
    const id = seeded.owner.eventTypeIds["30min"]!;
    const headers = { "x-forwarded-for": "198.51.100.77" };
    const tooLong = await request.get(`/api/public/slots?target=${id}&start=2030-10-01&end=2030-12-31&tz=UTC`, { headers: { "x-forwarded-for": "198.51.100.78" } });
    expect(tooLong.status()).toBe(400);
    // Beyond the 60 day window: answered without busy times (fast).
    const far = `/api/public/slots?target=${id}&start=2031-06-01&end=2031-06-30&tz=UTC`;
    for (let i = 0; i < 60; i++) expect((await request.get(far, { headers })).status()).toBe(200);
    const limited = await request.get(far, { headers });
    expect(limited.status()).toBe(429);
    expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
  });

  test("refuses bot and cross-site booking submissions", async ({ request, baseURL }) => {
    const id = seeded.owner.eventTypeIds["30min"]!;
    const data = {
      target: { kind: "event_type", eventTypeId: id },
      start: "2030-10-08T19:00:00Z",
      invitee: { name: "Ana Lima", email: "ana@example.com", timezone: "America/New_York" },
      answers: [],
      website: "",
    };
    const bot = await request.post("/api/public/bookings", { data, headers: { origin: baseURL!, "x-forwarded-for": "203.0.113.20" } });
    expect(bot.status()).toBe(400);
    expect(await bot.json()).toMatchObject({ ok: false, code: "blocked" });
    const cross = await request.post("/api/public/bookings", { data, headers: { origin: "https://evil.example", "x-forwarded-for": "203.0.113.21" } });
    expect(cross.status()).toBe(403);
    const status = await request.get("/api/public/bookings/00000000-0000-4000-8000-000000000000/status");
    expect(status.status()).toBe(404);
  });
});
