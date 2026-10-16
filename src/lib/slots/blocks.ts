// Combined blocks per pooling type (ARCHITECTURE section 7.3 step 3, SPEC SCH-01 step 4, SCH-15, SCH-16, SCH-17).
//
// Both levels are combined the same way: the intersection of every required host's blocks and, for each pool, the
// union of that pool's members' blocks (single host: that host's blocks; collective: intersection of all hosts;
// round robin: union of the pool; multi_pool: required hosts intersected with each pool's union). Combined anchor
// blocks are finally split at local midnights of the event's range zone, so the grid of a date never depends on
// other dates (unions of hosts in different zones could otherwise chain across days).
import { intersectAll, mergeIntervals, splitAtLocalMidnights, unionIntervals } from "./busy";
import type { HostGroups } from "./pooling";
import type { HostBlocks } from "./schedule";
import type { HostInput, Interval } from "./types";

export type CombinedBlocks = { anchors: Interval[]; containment: Interval[] };

const NO_BLOCKS: HostBlocks = { anchors: [], containment: [], holidayAnchors: [], holidayContainment: [] };

function combineLevel(groups: HostGroups, get: (h: HostInput) => Interval[]): Interval[] {
  const lists: Interval[][] = [];
  for (const h of groups.required) lists.push(get(h));
  for (const p of groups.pools) lists.push(unionIntervals(p.members.map(get)));
  if (lists.length === 0) return [];
  if (lists.length === 1) return lists[0]!.map((i) => ({ start: i.start, end: i.end }));
  return intersectAll(lists);
}

/** Combined anchor blocks (split at range zone midnights) and combined containment blocks (merged). */
export function combineBlocks(
  groups: HostGroups,
  blocksOf: (userId: string) => HostBlocks | undefined,
  rangeZone: string,
): CombinedBlocks {
  const of = (h: HostInput) => blocksOf(h.userId) ?? NO_BLOCKS;
  const anchors = splitAtLocalMidnights(
    combineLevel(groups, (h) => of(h).anchors),
    rangeZone,
  );
  const containment = mergeIntervals(combineLevel(groups, (h) => of(h).containment));
  return { anchors, containment };
}

/** Index of the interval of a sorted, non-overlapping list that contains instant `t`, or -1. */
export function findContaining(list: readonly Interval[], t: number): number {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const i = list[mid]!;
    if (t < i.start) hi = mid - 1;
    else if (t >= i.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** True when [start, end) lies inside one interval of a sorted, merged list. */
export function fitsInside(list: readonly Interval[], start: number, end: number): boolean {
  const k = findContaining(list, start);
  return k >= 0 && list[k]!.end >= end;
}
