// The contract files are wired (ARCHITECTURE 12.1, 12.2, 25): with the real subscriber registry and job registry, a
// booking's booking.created job runs the lifecycle subscriber, and a cancel through the contract index sends the
// cancellation; lifecycle job types have handlers (no "no_handler" reschedules).
import { eq, like } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/calendars", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/calendars")>();
  return {
    ...real,
    getExternalBusy: async (p: { userIds: string[] }) => Object.fromEntries(p.userIds.map((id) => [id, { ok: true, stale: false, nocal: false, busy: [] }])),
  };
});
vi.mock("@/lib/links", () => ({
  resolveBookingCode: async () => null,
  consumeLinkInTx: async () => {},
  getReservedIntervals: async () => ({}),
  LinkUsedError: class LinkUsedError extends Error {},
}));
vi.mock("@/lib/polls", () => ({ getPollReservedIntervals: async () => ({}), markPollBookedInTx: async () => {} }));

const { jobs } = await import("@/db/schema");
const { setFakeNow, resetFakeTime } = await import("@/lib/time/now");
const { runDueJobs } = await import("@/lib/jobs");
const { handlers } = await import("@/lib/lifecycle/jobs");
const { subscribers } = await import("@/lib/lifecycle/subscribers");
const lifecycle = await import("@/lib/lifecycle");
const { useTestDb } = await import("../helpers/db");
const { CAFE, NOW, book, la, outbox, setupHost } = await import("./helpers");

const t = useTestDb();
beforeEach(() => setFakeNow(NOW));
afterEach(() => resetFakeTime());

describe("lifecycle contract wiring", () => {
  it("registers subscribers and job handlers", () => {
    expect(Object.keys(subscribers).sort()).toEqual(["booking.canceled", "booking.created", "booking.rescheduled", "meeting.updated"]);
    expect(Object.keys(handlers).sort()).toEqual([
      "lifecycle.cancel_user_meetings",
      "lifecycle.meeting_moved",
      "lifecycle.provision_retry",
      "lifecycle.request_reschedule_reminder",
    ]);
  });

  it("runs through the real registries", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const r = await book(fx, la("2030-10-08 10:00"), { invitee: { name: "Ana Lima", email: "ana.w@example.com", timezone: "UTC" } });
    const queued = await t.db.select().from(jobs).where(like(jobs.type, "event:booking.created:%"));
    expect(queued.map((j) => j.type)).toContain("event:booking.created:lifecycle");
    await runDueJobs({ budgetMs: 20_000, types: ["event:booking.created:lifecycle"] });
    expect(await outbox(t.db, { to: "ana.w@example.com", template: "lifecycle.invitee_confirmation" })).toHaveLength(1);
    await lifecycle.cancelInvitee({ inviteeId: r.inviteeId, actor: { type: "invitee" } });
    await runDueJobs({ budgetMs: 20_000, types: ["event:booking.canceled:lifecycle"] });
    expect(await outbox(t.db, { to: "ana.w@example.com", template: "lifecycle.invitee_canceled" })).toHaveLength(1);
    const [job] = await t.db.select().from(jobs).where(eq(jobs.type, "event:booking.canceled:lifecycle"));
    expect(job!.status).toBe("succeeded");
    expect((await lifecycle.resolveActiveInviteeChain(r.inviteeId))!.id).toBe(r.inviteeId);
  });
});
