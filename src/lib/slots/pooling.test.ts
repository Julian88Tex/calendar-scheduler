// Host grouping, equal distribution hiding and pooling decisions (SCH-15 to SCH-17).
import { describe, expect, it } from "vitest";
import { decidePooling, equalDistributionHidden, groupHosts } from "./pooling";
import { host, rules } from "./testing";

const rr = (id: string, count: number) => host(id, { poolId: "p", rr: { count, lastAssignedAt: null } });

describe("equalDistributionHidden (Jim/Karen)", () => {
  it.each([
    [3, 0, ["jim"]],
    [3, 1, []],
    [4, 1, ["jim"]],
    [5, 2, ["jim"]],
    [5, 3, []],
  ])("Jim %i, Karen %i hides %j", (jim, karen, hidden) => {
    expect([...equalDistributionHidden([rr("jim", jim), rr("karen", karen)])]).toEqual(hidden);
  });

  it("the minimum is over all pool members, including unavailable ones, and missing counts are 0", () => {
    expect([...equalDistributionHidden([rr("a", 3), host("b", { poolId: "p", rr: null })])]).toEqual(["a"]);
  });
});

describe("groupHosts", () => {
  it("solo and collective treat every host as required", () => {
    expect(groupHosts(rules({ pooling: "collective" }), [host("a"), host("b", { poolId: "x" })]).required.map((h) => h.userId)).toEqual(["a", "b"]);
    expect(groupHosts(rules(), [host("a"), host("a")]).hosts).toHaveLength(1);
  });

  it("round robin and multi pool split required hosts and pools in the rules' order", () => {
    const g = groupHosts(
      rules({ pooling: "multi_pool", pools: [{ id: "p2", distribution: "equal" }, { id: "p1", distribution: "availability" }] }),
      [host("a"), host("b", { poolId: "p1" }), host("c", { poolId: "p2" }), host("d", { poolId: "unknown" })],
    );
    expect(g.required.map((h) => h.userId)).toEqual(["a"]);
    expect(g.pools.map((p) => [p.id, p.distribution, p.members.map((m) => m.userId)])).toEqual([
      ["p2", "equal", ["c"]],
      ["p1", "availability", ["b"]],
      ["unknown", "availability", ["d"]],
    ]);
  });
});

describe("decidePooling", () => {
  const free = (...ids: string[]) => (id: string) => ids.includes(id);

  it("single host has no pooling code", () => {
    const g = groupHosts(rules(), [host("a")]);
    expect(decidePooling(g, free())).toMatchObject({ available: false, reasons: [] });
    expect(decidePooling(g, free("a"))).toMatchObject({ available: true, capacity: 1, eligibleByPool: { required: ["a"] } });
  });

  it("collective needs everyone (HOST)", () => {
    const g = groupHosts(rules({ pooling: "collective" }), [host("a"), host("b")]);
    expect(decidePooling(g, free("a"))).toMatchObject({ available: false, reasons: ["HOST"] });
  });

  it("round robin: ROUNDROBIN without free hosts, UNFAIR when all free hosts are hidden, capacity = eligible count", () => {
    const g = groupHosts(rules({ pooling: "round_robin", pools: [{ id: "p", distribution: "equal" }] }), [rr("jim", 3), rr("karen", 0), rr("lee", 0)]);
    expect(decidePooling(g, free())).toMatchObject({ available: false, reasons: ["ROUNDROBIN"] });
    expect(decidePooling(g, free("jim"))).toMatchObject({ available: false, reasons: ["UNFAIR"] });
    expect(decidePooling(g, free("jim", "karen", "lee"))).toMatchObject({ available: true, capacity: 2, eligibleHostIds: ["karen", "lee"] });
  });

  it("multi pool: required plus one per pool; capacity 1 with a required host", () => {
    const g = groupHosts(rules({ pooling: "multi_pool", pools: [{ id: "p1", distribution: "availability" }, { id: "p2", distribution: "availability" }] }), [
      host("a"),
      host("b", { poolId: "p1" }),
      host("c", { poolId: "p1" }),
      host("d", { poolId: "p2" }),
    ]);
    expect(decidePooling(g, free("a", "d"))).toMatchObject({ available: false, reasons: ["ROUNDROBIN"] });
    expect(decidePooling(g, free("a", "b", "c", "d"))).toMatchObject({ available: true, capacity: 1, eligibleByPool: { required: ["a"], p1: ["b", "c"], p2: ["d"] } });
    expect(decidePooling(g, free("b", "d"))).toMatchObject({ available: false, reasons: ["HOST"] });
  });

  it("no hosts are never available", () => {
    expect(decidePooling(groupHosts(rules(), []), free())).toMatchObject({ available: false, capacity: 0 });
  });
});
