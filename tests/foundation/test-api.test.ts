// /api/test/* guard and routes: 404 without E2E_TEST_MODE=1 and the matching x-e2e-secret header, and whenever
// VERCEL is set; reset, time (visible to now() and SQL $now comparisons), outbox and fake-calendar work.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, gt, sql } from "drizzle-orm";
import { calendars, emailOutbox, externalEvents, jobs, users } from "@/db/schema";
import { firstRow } from "@/db/helpers";
import { isTestApiRequest, testApiEnabled } from "@/app/api/test/_lib/guard";
import { POST as resetPOST } from "@/app/api/test/reset/route";
import { GET as timeGET, POST as timePOST } from "@/app/api/test/time/route";
import { GET as outboxGET } from "@/app/api/test/outbox/route";
import { POST as fakeCalendarPOST } from "@/app/api/test/fake-calendar/route";
import { POST as loginPOST } from "@/app/api/test/login/route";
import { now, resetFakeTime } from "@/lib/time/now";
import { useTestDb } from "../helpers/db";
import { createUser } from "../factories";

const SECRET = "test-secret-1234567890";
const req = (path: string, init: { method?: string; body?: unknown; secret?: string | null } = {}) =>
  new Request(`http://localhost:3000${path}`, {
    method: init.method ?? "POST",
    headers: {
      "content-type": "application/json",
      ...(init.secret === null ? {} : { "x-e2e-secret": init.secret ?? SECRET }),
    },
    body: init.body === undefined || (init.method ?? "POST") === "GET" ? undefined : JSON.stringify(init.body),
  });

const env = process.env as Record<string, string | undefined>;

describe("test API guard", () => {
  afterEach(() => {
    delete env.E2E_TEST_MODE;
    delete env.E2E_SECRET;
    delete env.VERCEL;
  });

  it("is disabled unless E2E_TEST_MODE=1, a secret is configured and VERCEL is unset", () => {
    expect(testApiEnabled({})).toBe(false);
    expect(testApiEnabled({ E2E_TEST_MODE: "1" })).toBe(false);
    expect(testApiEnabled({ E2E_SECRET: SECRET })).toBe(false);
    expect(testApiEnabled({ E2E_TEST_MODE: "1", E2E_SECRET: SECRET })).toBe(true);
    expect(testApiEnabled({ E2E_TEST_MODE: "1", E2E_SECRET: SECRET, VERCEL: "1" })).toBe(false);
    expect(testApiEnabled({ E2E_TEST_MODE: "true", E2E_SECRET: SECRET })).toBe(false);
  });

  it("requires the exact x-e2e-secret header", () => {
    const e = { E2E_TEST_MODE: "1", E2E_SECRET: SECRET };
    expect(isTestApiRequest(req("/api/test/reset"), e)).toBe(true);
    expect(isTestApiRequest(req("/api/test/reset", { secret: null }), e)).toBe(false);
    expect(isTestApiRequest(req("/api/test/reset", { secret: "wrong" }), e)).toBe(false);
    expect(isTestApiRequest(req("/api/test/reset", { secret: `${SECRET}x` }), e)).toBe(false);
    expect(isTestApiRequest(req("/api/test/reset"), { ...e, VERCEL: "1" })).toBe(false);
  });

  it("every route answers 404 without the secret, without E2E mode, and on Vercel", async () => {
    const routes = [
      () => resetPOST(req("/api/test/reset", { secret: null })),
      () => timePOST(req("/api/test/time", { body: { now: null }, secret: null })),
      () => outboxGET(req("/api/test/outbox", { method: "GET", secret: null })),
      () => fakeCalendarPOST(req("/api/test/fake-calendar", { body: {}, secret: null })),
      () => loginPOST(req("/api/test/login", { body: {}, secret: null })),
    ];
    env.E2E_TEST_MODE = "1";
    env.E2E_SECRET = SECRET;
    for (const call of routes) expect((await call()).status).toBe(404);

    // Correct secret but E2E mode off.
    delete env.E2E_TEST_MODE;
    expect((await resetPOST(req("/api/test/reset"))).status).toBe(404);
    expect((await timeGET(req("/api/test/time", { method: "GET" }))).status).toBe(404);

    // Correct secret and E2E mode, but on Vercel.
    env.E2E_TEST_MODE = "1";
    env.VERCEL = "1";
    expect((await resetPOST(req("/api/test/reset"))).status).toBe(404);
    expect((await timePOST(req("/api/test/time", { body: { now: "2030-01-01T00:00:00Z" } }))).status).toBe(404);
  });
});

describe("test API routes", () => {
  const t = useTestDb();
  beforeEach(() => {
    env.E2E_TEST_MODE = "1";
    env.E2E_SECRET = SECRET;
    delete env.VERCEL;
  });
  afterEach(() => {
    resetFakeTime();
    delete env.E2E_TEST_MODE;
    delete env.E2E_SECRET;
  });

  it("time: the fake now is visible to now() and to SQL comparisons that receive $now", async () => {
    const res = await timePOST(req("/api/test/time", { body: { now: "2031-03-01T09:00:00Z" } }));
    expect(res.status).toBe(200);
    expect(Math.abs(now().getTime() - Date.parse("2031-03-01T09:00:00Z"))).toBeLessThan(2000);

    // A job due in 2030 is due "now" only for a business clock in 2031.
    await t.db.insert(jobs).values({ type: "test.noop", runAt: new Date("2030-06-01T00:00:00Z") });
    const due = await t.db.select().from(jobs).where(and(eq(jobs.type, "test.noop"), gt(sql`${now()}::timestamptz`, jobs.runAt)));
    expect(due).toHaveLength(1);

    const adv = await (await timePOST(req("/api/test/time", { body: { advanceMs: 3_600_000 } }))).json();
    expect(Date.parse(adv.now)).toBeGreaterThan(Date.parse("2031-03-01T09:59:00Z"));
    const reset = await (await timePOST(req("/api/test/time", { body: { now: null } }))).json();
    expect(reset.offsetMs).toBe(0);
    expect((await timePOST(req("/api/test/time", { body: {} }))).status).toBe(400);
  });

  it("outbox: lists emails to an address with extracted links", async () => {
    await t.db.insert(emailOutbox).values({
      toAddresses: ["ana@example.com"],
      fromAddress: "notifications@localhost",
      subject: "Confirmed: 30 Minute Meeting",
      html: '<p><a href="http://localhost:3000/cancellations/abc?x=1&amp;y=2">Cancel</a></p>',
      text: "Reschedule: http://localhost:3000/reschedulings/abc.",
      template: "booking_confirmed",
      category: "transactional",
      status: "stored",
      idempotencyKey: "test/1",
    });
    const res = await outboxGET(req("/api/test/outbox?to=Ana@Example.com", { method: "GET" }));
    expect(res.status).toBe(200);
    const { emails } = await res.json();
    expect(emails).toHaveLength(1);
    expect(emails[0].links).toEqual([
      "http://localhost:3000/cancellations/abc?x=1&y=2",
      "http://localhost:3000/reschedulings/abc",
    ]);
    const none = await (await outboxGET(req("/api/test/outbox?to=nobody@example.com", { method: "GET" }))).json();
    expect(none.emails).toHaveLength(0);
  });

  it("fake-calendar: injects conflict-checked busy events on a read-only connection", async () => {
    const user = await createUser(t.db);
    const res = await fakeCalendarPOST(
      req("/api/test/fake-calendar", {
        body: {
          email: user.email,
          events: [
            { start: "2031-03-02T15:00:00Z", end: "2031-03-02T16:00:00Z", title: "Dentist" },
            { start: "2031-03-03T00:00:00Z", end: "2031-03-04T00:00:00Z", allDay: true },
          ],
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const [calendar] = await t.db.select().from(calendars).where(eq(calendars.id, body.calendarId));
    expect(calendar.checkConflicts).toBe(true);
    const events = await t.db.select().from(externalEvents).where(eq(externalEvents.calendarId, body.calendarId));
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.allDay)?.allDayStartDate).toBe("2031-03-03");

    // replace (default) swaps the events; the connection is reused
    const again = await (await fakeCalendarPOST(req("/api/test/fake-calendar", { body: { userId: user.id, events: [] } }))).json();
    expect(again.calendarId).toBe(body.calendarId);
    expect(await t.db.select().from(externalEvents).where(eq(externalEvents.calendarId, body.calendarId))).toHaveLength(0);

    const missing = await fakeCalendarPOST(req("/api/test/fake-calendar", { body: { email: "nobody@example.com" } }));
    expect(missing.status).toBe(404);
  });

  it("reset: truncates application tables", async () => {
    await createUser(t.db);
    const res = await resetPOST(req("/api/test/reset"));
    expect(res.status).toBe(200);
    const row = firstRow<{ n: string | number }>(await t.db.execute(sql`select count(*) as n from ${users}`));
    expect(Number(row?.n)).toBe(0);
  });
});
