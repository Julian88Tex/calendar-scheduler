// Host selection at booking time (SPEC SCH-16, SCH-17, SCH-19; ARCHITECTURE section 7.3 "selectHosts"). Also
// assigns the provisional host of a booking reservation.
//
// Per pool, among the slot's eligible hosts of that pool:
// - "Maximize for availability": highest priority, then least recently assigned (never assigned first), then random.
// - "Optimize for equal distribution": lowest count, then least recently assigned, then random (priority ignored).
// Required co-hosts always attend. The organizer is the event type's organizer when attending, else the first
// required host, else the first pool's assignee. Reschedules with "Use same hosts" pass preferHostIds: a pool that
// contained an original host must give that host the meeting, or there is no assignment (null).
// Randomness is injectable (`random`, values in [0, 1)); the default draws from crypto.getRandomValues.
import { groupHosts, REQUIRED_KEY } from "./pooling";
import type { AssignmentResult, EventTypeRules, HostInput, Slot } from "./types";

export type AssignmentReason = AssignmentResult["byPool"][string]["reason"];

/** byPool entry with the additive `sameHost` flag (true when a "Use same hosts" reschedule kept the original host). */
export type PoolAssignment = AssignmentResult["byPool"][string] & { sameHost?: boolean };

export interface SelectHostsInput {
  rules: EventTypeRules;
  hosts: HostInput[];
  slot: Slot;
  random?: () => number;
  preferHostIds?: string[];
}

function cryptoRandom(): number {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  if (!c?.getRandomValues) throw new Error("selectHosts: no random source available; pass `random`");
  const buf = new Uint32Array(1);
  c.getRandomValues(buf);
  return buf[0]! / 4294967296;
}

function pickRandom<T>(items: readonly T[], random: () => number): T {
  const r = random();
  const v = Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.9999999999) : 0;
  return items[Math.floor(v * items.length)]!;
}

const lastAssigned = (h: HostInput) => h.rr?.lastAssignedAt ?? null;
const count = (h: HostInput) => Math.max(0, h.rr?.count ?? 0);

/** Compares least recently assigned first; never assigned (null) comes first. */
function compareRecency(a: HostInput, b: HostInput): number {
  const x = lastAssigned(a);
  const y = lastAssigned(b);
  if (x === y) return 0;
  if (x === null) return -1;
  if (y === null) return 1;
  return x - y;
}

/** Chooses one host of a pool; candidates are sorted by user id first so a given random value is reproducible. */
export function choosePoolHost(
  candidates: readonly HostInput[],
  distribution: "availability" | "equal",
  random: () => number,
): { host: HostInput; reason: AssignmentReason } | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  const primary =
    distribution === "equal"
      ? (a: HostInput, b: HostInput) => count(a) - count(b)
      : (a: HostInput, b: HostInput) => (b.priority ?? 3) - (a.priority ?? 3);
  const firstReason: AssignmentReason = distribution === "equal" ? "equal" : "priority";
  sorted.sort((a, b) => primary(a, b) || compareRecency(a, b));
  const best = sorted[0]!;
  if (sorted.length === 1) return { host: best, reason: firstReason };
  const tiedPrimary = sorted.filter((h) => primary(h, best) === 0);
  if (tiedPrimary.length === 1) return { host: best, reason: firstReason };
  const tiedBoth = tiedPrimary.filter((h) => compareRecency(h, best) === 0);
  if (tiedBoth.length === 1) return { host: best, reason: "least_recent" };
  return { host: pickRandom(tiedBoth, random), reason: "random" };
}

/** Assigns the meeting's hosts for a slot returned by computeSlots, or null when the slot cannot be staffed. */
export function selectHosts(input: SelectHostsInput): AssignmentResult | null {
  const { rules, slot } = input;
  const random = input.random ?? cryptoRandom;
  const groups = groupHosts(rules, input.hosts);
  const prefer = new Set(input.preferHostIds ?? []);
  const eligibleByPool = slot.eligibleByPool ?? {};

  const requiredEligible = new Set(eligibleByPool[REQUIRED_KEY] ?? slot.eligibleHostIds ?? []);
  const requiredIds = groups.required.map((h) => h.userId);
  if (!requiredIds.every((id) => requiredEligible.has(id))) return null;

  const hostIds: string[] = [...requiredIds];
  const byPool: Record<string, PoolAssignment> = {};
  for (const pool of groups.pools) {
    const eligible = new Set(eligibleByPool[pool.id] ?? []);
    const candidates = pool.members.filter((h) => eligible.has(h.userId));
    const preferred = pool.members.filter((h) => prefer.has(h.userId));
    if (preferred.length > 0) {
      const keep = preferred.find((h) => eligible.has(h.userId));
      if (!keep) return null;
      byPool[pool.id] = { userId: keep.userId, reason: pool.distribution === "equal" ? "equal" : "priority", sameHost: true };
      if (!hostIds.includes(keep.userId)) hostIds.push(keep.userId);
      continue;
    }
    const choice = choosePoolHost(candidates, pool.distribution, random);
    if (!choice) return null;
    byPool[pool.id] = { userId: choice.host.userId, reason: choice.reason };
    if (!hostIds.includes(choice.host.userId)) hostIds.push(choice.host.userId);
  }
  if (hostIds.length === 0) return null;

  const firstPool = groups.pools[0];
  const organizer = rules.organizerUserId;
  const organizerId =
    organizer && hostIds.includes(organizer)
      ? organizer
      : (requiredIds[0] ?? (firstPool ? byPool[firstPool.id]?.userId : undefined) ?? hostIds[0]!);
  return { hostIds, organizerId, byPool };
}
