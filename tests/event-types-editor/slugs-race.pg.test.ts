// Event type slugs and positions under concurrency on real Postgres (SPEC ET-11, ET-15, ET-23; run with npm run
// test:pg): every write that picks a slug or a position holds the profile's slug lock, so concurrent creates of the same
// name get "-2", "-3" ..., concurrent duplicates get "-copy", "-copy-2", and a typed slug is granted to one save only.
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workflows", () => ({ copyEventTypeReminders: vi.fn(async () => 0) }));
vi.mock("@/lib/calendars", () => ({ getDestinationCalendar: vi.fn(async () => null) }));
vi.mock("@/lib/conferencing", () => ({ getConferencingOptions: vi.fn(async () => ({})) }));

const { eventTypes } = await import("@/db/schema");
const { loadActorCtx } = await import("@/lib/authz");
const { duplicateEventType, getNewEventTypeEditorData, saveEventType } = await import("@/lib/event-types");
const f = await import("../factories");
const { createTestDb } = await import("../helpers/db");

describe.runIf(process.env.TEST_DATABASE_URL)("event type slug races on real Postgres", () => {
  it("concurrent creates with one name get unique slugs and positions", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 16 });
    try {
      const user = await f.createUser(t.db);
      await f.createSchedule(t.db, { userId: user.id });
      const actor = await loadActorCtx(t.db, user);
      const draft = { ...(await getNewEventTypeEditorData(actor, t.db)).draft, name: "Intro Call" };
      const results = await Promise.all(Array.from({ length: 6 }, () => saveEventType(t.db, actor, { id: null, version: null, draft })));
      expect(new Set(results.map((r) => r.slug))).toEqual(new Set(["intro-call", "intro-call-2", "intro-call-3", "intro-call-4", "intro-call-5", "intro-call-6"]));
      const rows = await t.db
        .select({ position: eventTypes.position })
        .from(eventTypes)
        .where(and(eq(eventTypes.ownerUserId, user.id), isNull(eventTypes.deletedAt)));
      expect(new Set(rows.map((r) => r.position)).size).toBe(6);
    } finally {
      await t.close();
    }
  });

  it("a typed slug is granted once; concurrent duplicates get distinct copy slugs", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 16 });
    try {
      const user = await f.createUser(t.db);
      await f.createSchedule(t.db, { userId: user.id });
      const actor = await loadActorCtx(t.db, user);
      const base = (await getNewEventTypeEditorData(actor, t.db)).draft;
      const typed = await Promise.allSettled(
        Array.from({ length: 4 }, (_, i) => saveEventType(t.db, actor, { id: null, version: null, draft: { ...base, name: `Coffee ${i}`, slug: "coffee" } })),
      );
      expect(typed.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const original = typed.find((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof saveEventType>>> => r.status === "fulfilled")!.value;
      const copies = await Promise.all(Array.from({ length: 3 }, () => duplicateEventType(t.db, actor, original.id)));
      expect(new Set(copies.map((c) => c.slug))).toEqual(new Set(["coffee-copy", "coffee-copy-2", "coffee-copy-3"]));
    } finally {
      await t.close();
    }
  });
});
