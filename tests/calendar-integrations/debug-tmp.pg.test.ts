import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/calendars/credentials", () => ({
  withConnection: async (connectionId: string, fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ connectionId, userId: "", provider: "google", accessToken: "fake-access", unavailableStatuses: [] }),
  encryptedTokenColumns: async () => ({}),
}));
vi.mock("@/lib/calendars/providers/registry", async () => {
  const { fakeCalendarProvider } = await import("../helpers/fake-providers");
  return { isCacheOnlyProvider: () => false, getProvider: (id: "google") => fakeCalendarProvider(id) };
});
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));
const { calendarSyncWindows, externalEvents } = await import("@/db/schema");
const { getExternalBusy, WINDOW_MS } = await import("@/lib/calendars/busy");
const { fakeCalendarProvider } = await import("../helpers/fake-providers");
const { createTestDb } = await import("../helpers/db");
const { DAY, HOUR, setupGoogle } = await import("./helpers");
describe.runIf(process.env.TEST_DATABASE_URL)("dbg", () => {
  it("x", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 4 });
    const g = await setupGoogle(t.db);
    const day = new Date(Math.floor((Date.now() + 20 * DAY) / DAY) * DAY);
    fakeCalendarProvider("google").setEvents(g.connectionId, g.externalIds[0]!, [{ externalId: "e1", start: new Date(day.getTime() + 9 * HOUR), end: new Date(day.getTime() + 10 * HOUR) }]);
    const r = await getExternalBusy({ userIds: [g.user.id], start: day, end: new Date(day.getTime() + DAY) });
    console.log(JSON.stringify(r), fakeCalendarProvider("google").calls.length);
    console.log(await t.db.select().from(externalEvents));
    console.log(await t.db.select().from(calendarSyncWindows));
    await t.close();
    expect(WINDOW_MS).toBeGreaterThan(0);
  });
});
