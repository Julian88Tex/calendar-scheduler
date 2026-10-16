// selectHosts (SCH-16, SCH-17, SCH-19): priority, least recent and random tie breaks, equal distribution, same-host
// reschedules, organizer choice, and two concurrent bookings landing on different hosts.
import { describe, expect, it } from "vitest";
import { computeSlots, selectHosts } from "@/lib/slots";
import type { HostInput, Slot } from "@/lib/slots";
import { choosePoolHost } from "./assign";
import { UTC, at, dayRange, host, input, reservedBusy, rules, schedule, seededRandom, weekly } from "./testing";

const pool = (distribution: "availability" | "equal" = "availability") => rules({ pooling: "round_robin", pools: [{ id: "p", distribution }] });
const slotFor = (eligible: string[], required: string[] = []): Slot => ({
  start: 0,
  end: 1,
  inviteesRemaining: eligible.length,
  eligibleHostIds: [...required, ...eligible],
  eligibleByPool: required.length ? { required, p: eligible } : { p: eligible },
});
const rrHost = (id: string, priority: 1 | 2 | 3 | 4 | 5, count: number, lastAssignedAt: number | null) =>
  host(id, { poolId: "p", priority, rr: { count, lastAssignedAt } });

describe("Maximize for availability", () => {
  it("highest priority wins", () => {
    const hosts = [rrHost("a", 3, 0, null), rrHost("b", 5, 9, 100), rrHost("c", 4, 0, null)];
    expect(selectHosts({ rules: pool(), hosts, slot: slotFor(["a", "b", "c"]) })).toEqual({
      hostIds: ["b"],
      organizerId: "b",
      byPool: { p: { userId: "b", reason: "priority" } },
    });
  });

  it("ties on priority go to the least recently assigned, never assigned first", () => {
    const hosts = [rrHost("a", 4, 2, 500), rrHost("b", 4, 5, 100), rrHost("c", 4, 0, null), rrHost("d", 2, 0, null)];
    expect(selectHosts({ rules: pool(), hosts, slot: slotFor(["a", "b", "c", "d"]) })!.byPool.p).toEqual({ userId: "c", reason: "least_recent" });
    expect(selectHosts({ rules: pool(), hosts, slot: slotFor(["a", "b", "d"]) })!.byPool.p).toEqual({ userId: "b", reason: "least_recent" });
  });

  it("full ties are random (injectable) and reproducible per random value", () => {
    const hosts = [rrHost("x", 3, 0, null), rrHost("y", 3, 0, null), rrHost("z", 3, 0, null)];
    const pick = (r: number) => selectHosts({ rules: pool(), hosts, slot: slotFor(["x", "y", "z"]), random: () => r })!.byPool.p;
    expect(pick(0)).toEqual({ userId: "x", reason: "random" });
    expect(pick(0.5)).toEqual({ userId: "y", reason: "random" });
    expect(pick(0.99)).toEqual({ userId: "z", reason: "random" });
    // A seeded generator spreads ties over every host.
    const rnd = seededRandom(7);
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(selectHosts({ rules: pool(), hosts, slot: slotFor(["x", "y", "z"]), random: rnd })!.byPool.p!.userId);
    expect(seen).toEqual(new Set(["x", "y", "z"]));
  });

  it("only eligible hosts are considered; no eligible host means no assignment", () => {
    const hosts = [rrHost("a", 5, 0, null), rrHost("b", 1, 0, null)];
    expect(selectHosts({ rules: pool(), hosts, slot: slotFor(["b"]) })!.byPool.p!.userId).toBe("b");
    expect(selectHosts({ rules: pool(), hosts, slot: slotFor([]) })).toBeNull();
  });

  it("the default random source works without injection", () => {
    const hosts = [rrHost("x", 3, 0, null), rrHost("y", 3, 0, null)];
    expect(["x", "y"]).toContain(selectHosts({ rules: pool(), hosts, slot: slotFor(["x", "y"]) })!.byPool.p!.userId);
  });
});

describe("Optimize for equal distribution", () => {
  it("lowest count first (priority ignored), then least recent, then random", () => {
    const hosts = [rrHost("a", 5, 4, null), rrHost("b", 1, 2, 300), rrHost("c", 1, 2, 200), rrHost("d", 1, 3, null)];
    expect(selectHosts({ rules: pool("equal"), hosts, slot: slotFor(["a", "b", "c", "d"]) })!.byPool.p).toEqual({ userId: "c", reason: "least_recent" });
    expect(selectHosts({ rules: pool("equal"), hosts, slot: slotFor(["a", "d"]) })!.byPool.p).toEqual({ userId: "d", reason: "equal" });
  });

  it("choosePoolHost reports the deciding rule", () => {
    const tie = [rrHost("a", 3, 1, 10), rrHost("b", 3, 1, 10)];
    expect(choosePoolHost(tie, "equal", () => 0.9)).toMatchObject({ reason: "random" });
    expect(choosePoolHost([], "equal", () => 0)).toBeNull();
  });
});

describe("required hosts, pools and organizer", () => {
  const multi = rules({
    pooling: "multi_pool",
    pools: [
      { id: "p1", distribution: "availability" },
      { id: "p2", distribution: "equal" },
    ],
    organizerUserId: "d",
  });
  const hosts: HostInput[] = [host("a"), host("b", { poolId: "p1", priority: 5 }), host("c", { poolId: "p1" }), host("d", { poolId: "p2" })];
  const slot: Slot = { start: 0, end: 1, inviteesRemaining: 1, eligibleHostIds: ["a", "b", "c", "d"], eligibleByPool: { required: ["a"], p1: ["b", "c"], p2: ["d"] } };

  it("a multi-pool booking includes the required host and one host per pool (TM-10)", () => {
    expect(selectHosts({ rules: multi, hosts, slot })).toEqual({
      hostIds: ["a", "b", "d"],
      organizerId: "d",
      byPool: { p1: { userId: "b", reason: "priority" }, p2: { userId: "d", reason: "equal" } },
    });
  });

  it("the organizer falls back to the first required host, then the first pool's assignee", () => {
    expect(selectHosts({ rules: { ...multi, organizerUserId: "nobody" }, hosts, slot })!.organizerId).toBe("a");
    const rrOnly = selectHosts({ rules: pool(), hosts: [rrHost("x", 3, 0, null)], slot: slotFor(["x"]) });
    expect(rrOnly!.organizerId).toBe("x");
  });

  it("an unavailable required host gives no assignment", () => {
    expect(selectHosts({ rules: multi, hosts, slot: { ...slot, eligibleByPool: { ...slot.eligibleByPool, required: [] } } })).toBeNull();
  });

  it("collective: every host attends", () => {
    const r = selectHosts({
      rules: rules({ pooling: "collective" }),
      hosts: [host("a"), host("b")],
      slot: { start: 0, end: 1, inviteesRemaining: 1, eligibleHostIds: ["a", "b"], eligibleByPool: { required: ["a", "b"] } },
    });
    expect(r).toEqual({ hostIds: ["a", "b"], organizerId: "a", byPool: {} });
  });

  it('"Use same hosts" reschedules keep the original pool host or fail', () => {
    expect(selectHosts({ rules: multi, hosts, slot, preferHostIds: ["a", "c", "d"] })!.byPool.p1).toEqual({ userId: "c", reason: "priority", sameHost: true });
    const busyC = { ...slot, eligibleByPool: { ...slot.eligibleByPool, p1: ["b"] } };
    expect(selectHosts({ rules: multi, hosts, slot: busyC, preferHostIds: ["a", "c", "d"] })).toBeNull();
  });
});

describe("two concurrent bookings at the same time go to different hosts", () => {
  it("the first booking's hold blocks only its host, so the second one is assigned to the other host", () => {
    const sched = schedule(UTC, weekly({ all: [["09:00", "17:00"]] }));
    const start = at("2026-10-13 10:00", UTC);
    const hosts = [host("a", { poolId: "p", schedule: sched, priority: 5 }), host("b", { poolId: "p", schedule: sched })];
    const first = computeSlots(input({ rules: pool(), hosts, query: dayRange("2026-10-13", UTC) })).slots.find((s) => s.start === start)!;
    expect(first.inviteesRemaining).toBe(2);
    const a = selectHosts({ rules: pool(), hosts, slot: first })!;
    expect(a.hostIds).toEqual(["a"]);
    const held = hosts.map((h) => (h.userId === "a" ? { ...h, busy: [reservedBusy(start, start + 1_800_000, { reservationKey: "r1" })] } : h));
    const second = computeSlots(input({ rules: pool(), hosts: held, query: dayRange("2026-10-13", UTC) })).slots.find((s) => s.start === start)!;
    expect(selectHosts({ rules: pool(), hosts: held, slot: second })!.hostIds).toEqual(["b"]);
  });
});
