// Domain events (ARCHITECTURE section 12.1): publishEvent writes domain_events plus one job per registered subscriber
// key (lifecycle, workflows, webhooks, contacts, links, polls, analytics, payments, routing), inside the caller's
// transaction; the dispatcher job runs each subscriber once. Every module subscriber file is mocked.
import { eq, like } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ received: [] as { key: string; event: unknown }[], failOnce: new Set<string>() }));

vi.mock("@/lib/lifecycle/subscribers", () => ({
  subscribers: {
    "booking.created": async (event: unknown) => {
      if (h.failOnce.delete("lifecycle")) throw new Error("provider down");
      h.received.push({ key: "lifecycle", event });
    },
    "booking.canceled": async (event: unknown) => void h.received.push({ key: "lifecycle", event }),
  },
}));
const make = (key: string) => ({
  subscribers: { "booking.created": async (event: unknown) => void h.received.push({ key, event }) },
});
vi.mock("@/lib/workflows/subscribers", () => make("workflows"));
vi.mock("@/lib/webhooks/subscribers", () => make("webhooks"));
vi.mock("@/lib/contacts/subscribers", () => make("contacts"));
vi.mock("@/lib/links/subscribers", () => make("links"));
vi.mock("@/lib/polls/subscribers", () => make("polls"));
vi.mock("@/lib/analytics/subscribers", () => make("analytics"));
vi.mock("@/lib/payments/subscribers", () => make("payments"));
vi.mock("@/lib/routing/subscribers", () => make("routing"));
for (const m of ["admin", "booking", "calendars", "contacts", "lifecycle", "links", "meetings", "payments", "polls", "settings", "teams", "webhooks", "workflows"]) {
  vi.doMock(`@/lib/${m}/jobs`, () => ({ handlers: {}, periodic: [] }));
}

const { domainEvents, jobs } = await import("@/db/schema");
const { publishEvent, eventJobPattern, EVENT_JOB_PRIORITY } = await import("@/lib/events");
const { SUBSCRIBER_KEYS, subscriberKeysFor } = await import("@/lib/events/registry");
const { parseEventJobType } = await import("@/lib/events/dispatch");
const { enqueueJob, runDueJobs } = await import("@/lib/jobs");
const { setFakeNow, resetFakeTime } = await import("@/lib/time/now");
const { useTestDb } = await import("../helpers/db");

const t = useTestDb();
const ORG = "00000000-0000-4000-8000-0000000000aa";
const payload = { scheduledEventId: "00000000-0000-4000-8000-000000000001", inviteeId: "00000000-0000-4000-8000-000000000002", source: "booking_page" };
const ALL_KEYS = ["lifecycle", "workflows", "webhooks", "contacts", "links", "polls", "analytics", "payments", "routing"];

beforeEach(async () => {
  await t.db.delete(jobs);
  await t.db.delete(domainEvents);
  h.received.length = 0;
  h.failOnce.clear();
  resetFakeTime();
});

describe("publishEvent", () => {
  it("fans out one job per registered subscriber key with the documented shape", async () => {
    expect([...SUBSCRIBER_KEYS]).toEqual(ALL_KEYS);
    expect(subscriberKeysFor("booking.created")).toEqual(ALL_KEYS);
    setFakeNow("2033-01-01T10:00:00Z");
    const id = await t.db.transaction((tx) =>
      publishEvent(tx, "booking.created", payload, { organizationId: ORG, actor: { type: "invitee", name: "Sam" } }),
    );
    const [event] = await t.db.select().from(domainEvents).where(eq(domainEvents.id, id));
    expect(event).toMatchObject({ type: "booking.created", organizationId: ORG, actor: { type: "invitee", name: "Sam" }, payload });
    expect(Math.abs(event!.occurredAt.getTime() - Date.parse("2033-01-01T10:00:00Z"))).toBeLessThan(5_000);
    const rows = await t.db.select().from(jobs).where(like(jobs.type, "event:booking.created:%"));
    expect(rows.map((r) => r.type).sort()).toEqual(ALL_KEYS.map((k) => `event:booking.created:${k}`).sort());
    for (const r of rows) {
      const key = r.type.split(":")[2]!;
      expect(r).toMatchObject({ priority: EVENT_JOB_PRIORITY, idempotencyKey: `${id}:${key}`, status: "pending" });
      expect(r.payload).toEqual({ domainEventId: id, type: "booking.created", payload, meta: { organizationId: ORG, actor: { type: "invitee", name: "Sam" } } });
    }
  });

  it("only creates jobs for subscribers that handle the type", async () => {
    await publishEvent(t.db, "booking.canceled", { ...payload, cancelerType: "host", reason: null, meetingCanceled: true }, { organizationId: ORG });
    const rows = await t.db.select({ type: jobs.type }).from(jobs);
    expect(rows.map((r) => r.type)).toEqual(["event:booking.canceled:lifecycle"]);
    await publishEvent(t.db, "poll.created", { pollId: "p" }, { organizationId: null });
    expect(await t.db.select().from(domainEvents)).toHaveLength(2);
    expect(await t.db.select().from(jobs)).toHaveLength(1);
  });

  it("rolls back with the caller's transaction (outbox pattern)", async () => {
    await expect(
      t.db.transaction(async (tx) => {
        await publishEvent(tx, "booking.created", payload, { organizationId: ORG });
        throw new Error("state change failed");
      }),
    ).rejects.toThrow("state change failed");
    expect(await t.db.select().from(domainEvents)).toHaveLength(0);
    expect(await t.db.select().from(jobs)).toHaveLength(0);
  });

  it("rejects unknown event types", async () => {
    await expect(publishEvent(t.db, "booking.exploded" as never, {} as never, { organizationId: null })).rejects.toThrow(/unknown event type/);
  });
});

describe("event dispatcher", () => {
  it("runs every subscriber once, retrying a failing one independently", async () => {
    h.failOnce.add("lifecycle");
    setFakeNow("2033-02-01T10:00:00Z");
    const id = await publishEvent(t.db, "booking.created", payload, { organizationId: ORG });
    const r = await runDueJobs({ budgetMs: 10_000, types: [eventJobPattern("booking.created")] });
    expect(r).toMatchObject({ ran: 9, succeeded: 8, failed: 1 });
    expect(h.received.map((x) => x.key).sort()).toEqual(ALL_KEYS.filter((k) => k !== "lifecycle").sort());
    expect(h.received[0]!.event).toEqual({ id, type: "booking.created", payload, meta: { organizationId: ORG } });
    setFakeNow("2033-02-01T10:01:00Z");
    await runDueJobs({ budgetMs: 10_000, types: [eventJobPattern("booking.created")] });
    expect(h.received.filter((x) => x.key === "lifecycle")).toHaveLength(1);
    // Running again does nothing: every subscriber ran exactly once.
    await runDueJobs({ budgetMs: 10_000, types: [eventJobPattern("booking.created")] });
    expect(h.received).toHaveLength(9);
  });

  it("marks malformed event jobs dead without retrying", async () => {
    const a = await enqueueJob(t.db, { type: "event:booking.created:lifecycle", payload: { nope: true } });
    const b = await enqueueJob(t.db, { type: "event:booking.created:nobody", payload: { domainEventId: "x", type: "booking.created", payload, meta: {} } });
    await runDueJobs({ budgetMs: 10_000, types: ["event:*"] });
    expect((await t.db.select().from(jobs).where(eq(jobs.id, a!)))[0]).toMatchObject({ status: "dead" });
    // A subscriber key that no longer subscribes is a no-op.
    expect((await t.db.select().from(jobs).where(eq(jobs.id, b!)))[0]).toMatchObject({ status: "succeeded" });
  });

  it("parses event job types", () => {
    expect(parseEventJobType("event:booking.no_show_created:workflows")).toEqual({ type: "booking.no_show_created", key: "workflows" });
    expect(parseEventJobType("event:event_type.created:webhooks")).toEqual({ type: "event_type.created", key: "webhooks" });
    expect(parseEventJobType("event:booking.nope:x")).toBeNull();
    expect(parseEventJobType("booking.created")).toBeNull();
  });
});
