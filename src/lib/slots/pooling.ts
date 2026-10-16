// Pooling rules (SPEC SCH-15 collective, SCH-16 round robin, SCH-17 multiple host pools; ARCHITECTURE 7.3 step 5e).
//
// Hosts form groups: every required host is its own group (all must attend) and each round robin pool is one group
// (any eligible member can take the meeting). Solo and collective event types treat every host as required.
// Round robin "Optimize for equal distribution" hides a host whose count is 3 or more above the lowest count of the
// pool (Jim 3, Karen 0 hides Jim; at 3 and 1 Jim is back; at 4 and 1 hidden again).
import type { EventTypeRules, HostInput, ReasonCode } from "./types";

export const EQUAL_DISTRIBUTION_GAP = 3;

/** eligibleByPool key of required hosts. */
export const REQUIRED_KEY = "required";

export type PoolGroup = { id: string; distribution: "availability" | "equal"; members: HostInput[]; hidden: Set<string> };
export type HostGroups = {
  pooling: EventTypeRules["pooling"];
  /** All distinct hosts in input order. */
  hosts: HostInput[];
  required: HostInput[];
  pools: PoolGroup[];
};

/** Hosts hidden by equal distribution: count - min(count over all pool members) >= 3. */
export function equalDistributionHidden(members: readonly HostInput[]): Set<string> {
  const hidden = new Set<string>();
  if (members.length === 0) return hidden;
  const count = (h: HostInput) => Math.max(0, h.rr?.count ?? 0);
  let min = Infinity;
  for (const m of members) min = Math.min(min, count(m));
  for (const m of members) if (count(m) - min >= EQUAL_DISTRIBUTION_GAP) hidden.add(m.userId);
  return hidden;
}

/** Splits hosts into required hosts and pools according to the pooling type. Duplicate user ids keep the first. */
export function groupHosts(rules: EventTypeRules, hostsIn: readonly HostInput[]): HostGroups {
  const seen = new Set<string>();
  const hosts: HostInput[] = [];
  for (const h of hostsIn) {
    if (!h || seen.has(h.userId)) continue;
    seen.add(h.userId);
    hosts.push(h);
  }
  if (rules.pooling !== "round_robin" && rules.pooling !== "multi_pool") {
    return { pooling: rules.pooling, hosts, required: hosts, pools: [] };
  }
  const required = hosts.filter((h) => h.poolId == null);
  const order: string[] = [];
  const distribution = new Map<string, "availability" | "equal">();
  for (const p of rules.pools ?? []) {
    if (!p || distribution.has(p.id)) continue;
    order.push(p.id);
    distribution.set(p.id, p.distribution === "equal" ? "equal" : "availability");
  }
  for (const h of hosts) {
    if (h.poolId != null && !distribution.has(h.poolId)) {
      order.push(h.poolId);
      distribution.set(h.poolId, "availability");
    }
  }
  const pools: PoolGroup[] = order.map((id) => {
    const members = hosts.filter((h) => h.poolId === id);
    const dist = distribution.get(id)!;
    return { id, distribution: dist, members, hidden: dist === "equal" ? equalDistributionHidden(members) : new Set() };
  });
  return { pooling: rules.pooling, hosts, required, pools };
}

export type PoolingDecision = {
  available: boolean;
  /** Pooling-level codes only (HOST, ROUNDROBIN, UNFAIR); host-level codes live in the host diagnostics. */
  reasons: ReasonCode[];
  eligibleHostIds: string[];
  eligibleByPool: Record<string, string[]>;
  /** Concurrent bookings the slot can take: 1 with required hosts, else the smallest pool's eligible count. */
  capacity: number;
};

/**
 * Decides a candidate from per-host availability. A single host with no pooling reports no pooling code (its own
 * reasons are the candidate's reasons); collective and required co-hosts report HOST; pools report ROUNDROBIN, or
 * UNFAIR when available members exist but equal distribution hides them all.
 */
export function decidePooling(groups: HostGroups, isAvailable: (userId: string) => boolean): PoolingDecision {
  const reasons: ReasonCode[] = [];
  const eligibleByPool: Record<string, string[]> = {};
  const eligibleHostIds: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      eligibleHostIds.push(id);
    }
  };
  let available = groups.required.length + groups.pools.length > 0;

  if (groups.required.length > 0) {
    const ids = groups.required.map((h) => h.userId);
    const allFree = ids.every((id) => isAvailable(id));
    if (!allFree) {
      available = false;
      const single = groups.pooling === null && groups.required.length === 1 && groups.pools.length === 0;
      if (!single) reasons.push("HOST");
    }
    eligibleByPool[REQUIRED_KEY] = ids;
    for (const id of ids) push(id);
  }

  let capacity = groups.required.length > 0 ? 1 : Infinity;
  for (const pool of groups.pools) {
    const free = pool.members.filter((h) => isAvailable(h.userId));
    const eligible = free.filter((h) => !pool.hidden.has(h.userId));
    eligibleByPool[pool.id] = eligible.map((h) => h.userId);
    for (const h of eligible) push(h.userId);
    if (eligible.length === 0) {
      available = false;
      reasons.push(free.length > 0 ? "UNFAIR" : "ROUNDROBIN");
    }
    capacity = Math.min(capacity, eligible.length);
  }
  if (!Number.isFinite(capacity)) capacity = 0;
  if (!available) capacity = 0;
  return { available, reasons, eligibleHostIds, eligibleByPool, capacity };
}
