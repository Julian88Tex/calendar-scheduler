// Combined blocks per pooling type (SCH-01 step 4, SCH-15, SCH-16, SCH-17).
import { describe, expect, it } from "vitest";
import { combineBlocks, findContaining, fitsInside } from "./blocks";
import { groupHosts } from "./pooling";
import { buildHostBlocks, type HostBlocks } from "./schedule";
import { LA, NY, UTC, at, host, rules, schedule, weekly } from "./testing";
import type { EventTypeRules, HostInput } from "./types";

const day = "2026-10-13";
const t = (time: string, date = day, zone = UTC) => at(`${date} ${time}`, zone);
const from = t("00:00");
const to = t("00:00", "2026-10-14");

function combined(r: EventTypeRules, hosts: HostInput[]) {
  const blocks = new Map<string, HostBlocks>();
  for (const h of hosts) blocks.set(h.userId, buildHostBlocks(h.schedule!, from, to));
  const all = combineBlocks(groupHosts(r, hosts), (id) => blocks.get(id), r.rangeZone);
  const onDay = (list: { start: number; end: number }[]) => list.filter((i) => i.end > from && i.start < to);
  return { anchors: onDay(all.anchors), containment: onDay(all.containment) };
}

const tue = (...pairs: [string, string][]) => schedule(UTC, weekly({ tue: pairs }));

describe("combineBlocks", () => {
  it("single host: the host's own anchors and containment", () => {
    const r = combined(rules(), [host("a", { schedule: tue(["09:00", "12:00"], ["12:00", "17:00"]) })]);
    expect(r.anchors).toEqual([{ start: t("09:00"), end: t("17:00") }]);
  });

  it("collective: intersection of all hosts", () => {
    const r = combined(rules({ pooling: "collective" }), [
      host("a", { schedule: tue(["09:00", "12:00"]) }),
      host("b", { schedule: tue(["09:15", "12:00"]) }),
      host("c", { schedule: tue(["08:00", "11:30"], ["11:45", "18:00"]) }),
    ]);
    expect(r.anchors).toEqual([
      { start: t("09:15"), end: t("11:30") },
      { start: t("11:45"), end: t("12:00") },
    ]);
  });

  it("round robin: union of the pool, merged into one grid per union block", () => {
    const r = combined(rules({ pooling: "round_robin", pools: [{ id: "p", distribution: "availability" }] }), [
      host("a", { poolId: "p", schedule: tue(["09:00", "10:00"]) }),
      host("b", { poolId: "p", schedule: tue(["09:30", "11:00"], ["13:00", "14:00"]) }),
    ]);
    expect(r.anchors).toEqual([
      { start: t("09:00"), end: t("11:00") },
      { start: t("13:00"), end: t("14:00") },
    ]);
  });

  it("multi_pool: required hosts intersected with each pool's union", () => {
    const r = combined(
      rules({ pooling: "multi_pool", pools: [{ id: "p1", distribution: "availability" }, { id: "p2", distribution: "equal" }] }),
      [
        host("a", { schedule: tue(["09:00", "15:00"]) }),
        host("b", { poolId: "p1", schedule: tue(["08:00", "10:00"]) }),
        host("c", { poolId: "p1", schedule: tue(["11:00", "16:00"]) }),
        host("d", { poolId: "p2", schedule: tue(["09:30", "12:00"]) }),
      ],
    );
    expect(r.anchors).toEqual([
      { start: t("09:30"), end: t("10:00") },
      { start: t("11:00"), end: t("12:00") },
    ]);
  });

  it("unions across zones are split at range zone midnights (round robin New York and Los Angeles evening hosts)", () => {
    const hosts = [
      host("ny", { poolId: "p", schedule: schedule(NY, weekly({ tue: [["20:00", "24:00"]], wed: [["00:00", "02:00"]] })) }),
      host("la", { poolId: "p", schedule: schedule(LA, weekly({ tue: [["20:00", "24:00"]] })) }),
    ];
    const blocks = new Map(hosts.map((h) => [h.userId, buildHostBlocks(h.schedule!, t("00:00", day, LA), t("00:00", "2026-10-15", LA))]));
    const r = combineBlocks(groupHosts(rules({ pooling: "round_robin", rangeZone: LA }), hosts), (id) => blocks.get(id), LA);
    // NY 20:00 to 02:00 is LA 17:00 to 23:00; LA 20:00 to 24:00; the union 17:00 to 24:00 LA ends at LA midnight.
    expect(r.anchors).toEqual([{ start: t("17:00", day, LA), end: t("00:00", "2026-10-14", LA) }]);
  });

  it("no hosts give no blocks", () => {
    expect(combineBlocks(groupHosts(rules(), []), () => undefined, UTC)).toEqual({ anchors: [], containment: [] });
  });
});

describe("findContaining and fitsInside", () => {
  const list = [
    { start: 0, end: 10 },
    { start: 20, end: 30 },
  ];
  it("binary searches the containing interval", () => {
    expect(findContaining(list, 0)).toBe(0);
    expect(findContaining(list, 10)).toBe(-1);
    expect(findContaining(list, 25)).toBe(1);
    expect(fitsInside(list, 20, 30)).toBe(true);
    expect(fitsInside(list, 5, 21)).toBe(false);
  });
});
