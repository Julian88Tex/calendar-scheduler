// Single-flight busy fetching on real Postgres (ARCHITECTURE 10.3; run with npm run test:pg): ten concurrent
// getExternalBusy calls for one stale (or never fetched) window make exactly one provider request and no unique
// violations; every caller gets the events.
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ delayMs: 400 }));

vi.mock("@/lib/calendars/credentials", () => ({
  withConnection: async (connectionId: string, fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ connectionId, userId: "", provider: "google", accessToken: "fake-access", unavailableStatuses: [] }),
  encryptedTokenColumns: async () => ({}),
}));
vi.mock("@/lib/calendars/providers/registry", async () => {
  const { fakeCalendarProvider } = await import("../helpers/fake-providers");
  return {
    isCacheOnlyProvider: (id: string) => id === "calendly_import",
    getProvider: (id: "google") => {
      const p = fakeCalendarProvider(id);
      return {
        ...p,
        capabilities: p.capabilities,
        listEvents: async (...args: Parameters<typeof p.listEvents>) => {
          await new Promise((r) => setTimeout(r, h.delayMs));
          return p.listEvents(...args);
        },
      };
    },
  };
});
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const { calendarSyncWindows } = await import("@/db/schema");
const { getExternalBusy, WINDOW_MS } = await import("@/lib/calendars/busy");
const { fakeCalendarProvider, resetFakeProviders } = await import("../helpers/fake-providers");
const { createTestDb } = await import("../helpers/db");
const { DAY, HOUR, setupGoogle } = await import("./helpers");

function midWindow(): Date {
  const now = Date.now();
  const start = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  let at = start + 15 * DAY;
  if (at < now + 2 * DAY) at = start + WINDOW_MS + 15 * DAY;
  return new Date(Math.floor(at / DAY) * DAY);
}

describe.runIf(process.env.TEST_DATABASE_URL)("busy cache single flight on real Postgres", () => {
  for (const scenario of ["never fetched", "stale"] as const) {
    it(`ten concurrent calls for a ${scenario} window make one provider request`, async () => {
      const t = await createTestDb({ kind: "postgres", poolSize: 14 });
      try {
        resetFakeProviders();
        const g = await setupGoogle(t.db);
        const day = midWindow();
        fakeCalendarProvider("google").setEvents(g.connectionId, g.externalIds[0]!, [
          { externalId: "e1", start: new Date(day.getTime() + 9 * HOUR), end: new Date(day.getTime() + 10 * HOUR), title: "Busy" },
        ]);
        const range = { start: new Date(day.getTime() + 6 * HOUR), end: new Date(day.getTime() + 18 * HOUR) };
        if (scenario === "stale") {
          await getExternalBusy({ userIds: [g.user.id], ...range });
          await t.db.update(calendarSyncWindows).set({ fetchedAt: new Date(Date.now() - HOUR) }).where(eq(calendarSyncWindows.calendarId, g.calendarIds[0]!));
          fakeCalendarProvider("google").calls.length = 0;
        }
        const results = await Promise.allSettled(
          Array.from({ length: 10 }, () => getExternalBusy({ userIds: [g.user.id], ...range, maxAgeSeconds: 180, timeoutMs: 4_000 })),
        );
        expect(results.filter((r) => r.status === "rejected")).toEqual([]);
        const calls = fakeCalendarProvider("google").calls.filter((c) => c.method === "listEvents");
        expect(calls).toHaveLength(1);
        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          expect(r.value[g.user.id]!.busy.map((b) => b.externalId)).toEqual(["e1"]);
          expect(r.value[g.user.id]!.nocal).toBe(false);
        }
        const windows = await t.db.select().from(calendarSyncWindows).where(eq(calendarSyncWindows.calendarId, g.calendarIds[0]!));
        expect(windows.every((w) => w.status === "ok" && w.fetchLeaseUntil === null)).toBe(true);
      } finally {
        await t.close();
      }
    });
  }
});
