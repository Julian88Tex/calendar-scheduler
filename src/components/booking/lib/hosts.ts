// Host header of the booking page details panel (SPEC BK-03 "Multi-host header"). Pure and client safe.
//
//   single host                  avatar and name
//   collective                   stacked avatars (3 shown, then "+n") and "A, B" or "A and {n} others"
//   round robin, team event      the team avatar and name (the assigned host is unknown before booking)
//   round robin, shared event    the pool's stacked avatars without names
//   multi pool                   the required co-hosts like collective plus a "+{n}" circle for the pools (our choice)
import { bt } from "./t";

export type HostPerson = { id: string; name: string; avatarUrl: string | null };

export type HostHeader =
  | { variant: "single"; person: HostPerson }
  | { variant: "team"; name: string; avatarUrl: string | null }
  | { variant: "stack"; people: HostPerson[]; extra: number; label: string | null };

export const STACK_MAX = 3;

/** "Ana" / "Ana, Ben" / "Ana and 3 others". */
export function hostNames(people: readonly HostPerson[]): string | null {
  if (people.length === 0) return null;
  if (people.length === 1) return people[0]!.name;
  if (people.length === 2) return bt("page.hostsPair", { first: people[0]!.name, second: people[1]!.name });
  return bt("page.hostsAnd", { first: people[0]!.name, count: people.length - 1 });
}

export type HostHeaderInput = {
  poolingType: "collective" | "round_robin" | "multi_pool" | null;
  scope: "personal" | "shared" | "team";
  /** The event type owner (personal and shared types). */
  owner: HostPerson | null;
  /** Hosts outside pools (collective hosts, multi-pool required co-hosts, the solo host), in position order. */
  required: HostPerson[];
  /** Hosts in pools (round robin, multi-pool), in position order. */
  pooled: HostPerson[];
  /** Number of pools (multi-pool). */
  poolCount: number;
  team: { name: string; avatarUrl: string | null } | null;
};

/** The header variant for an event type (see the file header). */
export function hostHeader(p: HostHeaderInput): HostHeader {
  const fallback = p.owner ?? p.required[0] ?? p.pooled[0] ?? null;
  switch (p.poolingType) {
    case "collective": {
      const people = p.required.length > 0 ? p.required : fallback ? [fallback] : [];
      if (people.length <= 1) return people[0] ? { variant: "single", person: people[0] } : teamOrEmpty(p);
      return { variant: "stack", people, extra: 0, label: hostNames(people) };
    }
    case "round_robin": {
      if (p.scope === "team" && p.team) return { variant: "team", name: p.team.name, avatarUrl: p.team.avatarUrl };
      const people = p.pooled.length > 0 ? p.pooled : p.required;
      if (people.length === 0) return fallback ? { variant: "single", person: fallback } : teamOrEmpty(p);
      return { variant: "stack", people, extra: 0, label: null };
    }
    case "multi_pool": {
      if (p.required.length === 0) {
        if (p.scope === "team" && p.team) return { variant: "team", name: p.team.name, avatarUrl: p.team.avatarUrl };
        return { variant: "stack", people: p.pooled, extra: 0, label: null };
      }
      return { variant: "stack", people: p.required, extra: Math.max(0, p.poolCount), label: hostNames(p.required) };
    }
    default: {
      if (fallback) return { variant: "single", person: fallback };
      return teamOrEmpty(p);
    }
  }
}

function teamOrEmpty(p: HostHeaderInput): HostHeader {
  if (p.team) return { variant: "team", name: p.team.name, avatarUrl: p.team.avatarUrl };
  return { variant: "stack", people: [], extra: 0, label: null };
}

/** Avatars to draw and the "+n" count of a stack header. */
export function stackParts(h: Extract<HostHeader, { variant: "stack" }>): { shown: HostPerson[]; more: number } {
  const shown = h.people.slice(0, STACK_MAX);
  return { shown, more: h.people.length - shown.length + h.extra };
}

/** The name shown for the host on the confirmation page and in copy ("You are scheduled with {name}"). */
export function headerName(h: HostHeader): string | null {
  if (h.variant === "single") return h.person.name;
  if (h.variant === "team") return h.name;
  return h.label;
}
