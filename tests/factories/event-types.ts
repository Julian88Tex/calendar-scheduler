// Event types of any kind (solo, group, collective, round robin, multi pool, adhoc), with hosts, pools and questions.
import type { DbOrTx } from "@/db";
import { eventTypeHostPools, eventTypeHosts, eventTypeQuestions, eventTypes } from "@/db/schema";
import type { LocationConfig } from "@/db/types";
import { newId, one, uniq } from "./_util";
import type { TestUser } from "./users";

export type EventTypeRow = typeof eventTypes.$inferSelect;
export type EventTypeHostRow = typeof eventTypeHosts.$inferSelect;
export type EventTypeHostPoolRow = typeof eventTypeHostPools.$inferSelect;
export type EventTypeQuestionRow = typeof eventTypeQuestions.$inferSelect;

export type HostSpec = {
  userId: string;
  /** Index into `pools` (null = required host). Defaults: round robin puts every host in pool 0. */
  poolIndex?: number | null;
  priority?: number;
  scheduleId?: string | null;
  locationOverride?: LocationConfig | null;
};

export type CreateEventTypeOptions = {
  /** Owner of a personal or shared type (organization taken from the owner). */
  owner?: TestUser;
  /** Team scope (scope becomes 'team'). */
  team?: { id: string; organizationId: string };
  organizationId?: string;
  scope?: "personal" | "shared" | "team";
  type?: "standard" | "adhoc";
  kind?: "solo" | "group";
  poolingType?: "collective" | "round_robin" | "multi_pool" | null;
  name?: string;
  slug?: string;
  durationMinutes?: number;
  maxInvitees?: number;
  /** Hosts; default the owner alone (pool null). */
  hosts?: HostSpec[];
  /** Pools for round robin and multi pool (default one pool for round robin). */
  pools?: { name?: string; distribution?: "availability" | "equal" }[];
  questions?: {
    label: string;
    type?: EventTypeQuestionRow["type"];
    required?: boolean;
    answerChoices?: string[];
    enabled?: boolean;
  }[];
  locations?: LocationConfig[];
  overrides?: Partial<typeof eventTypes.$inferInsert>;
};

/** A Google Meet location config (owner seed parity). */
export const googleMeetLocation = (position = 0): LocationConfig => ({ id: newId(), kind: "google_conference", position });

export async function createEventType(db: DbOrTx, opts: CreateEventTypeOptions = {}) {
  const scope = opts.scope ?? (opts.team ? "team" : opts.poolingType ? "shared" : "personal");
  const organizationId = opts.organizationId ?? opts.team?.organizationId ?? opts.owner?.organizationId;
  if (!organizationId) throw new Error("createEventType: pass owner, team or organizationId");
  if (scope !== "team" && !opts.owner) throw new Error("createEventType: personal and shared types need an owner");
  const kind = opts.kind ?? "solo";
  const slug = opts.slug ?? uniq("et");
  const eventType = one(
    await db
      .insert(eventTypes)
      .values({
        organizationId,
        ownerUserId: scope === "team" ? null : (opts.owner?.id ?? null),
        teamId: opts.team?.id ?? null,
        scope,
        type: opts.type ?? "standard",
        kind,
        poolingType: kind === "group" ? null : (opts.poolingType ?? null),
        name: opts.name ?? `Meeting ${slug}`,
        slug,
        durationMinutes: opts.durationMinutes ?? 30,
        maxInvitees: opts.maxInvitees ?? (kind === "group" ? 10 : 1),
        locations: opts.locations ?? [],
        createdByUserId: opts.owner?.id ?? null,
        ...opts.overrides,
      })
      .returning(),
    "event type",
  );

  const poolSpecs =
    opts.pools ?? (eventType.poolingType === "round_robin" ? [{ name: "Pool 1" }] : ([] as { name?: string }[]));
  const pools: EventTypeHostPoolRow[] = poolSpecs.length
    ? await db
        .insert(eventTypeHostPools)
        .values(
          poolSpecs.map((p, i) => ({
            eventTypeId: eventType.id,
            name: p.name ?? `Pool ${i + 1}`,
            distribution: (p as { distribution?: "availability" | "equal" }).distribution ?? "availability",
            position: i,
          })),
        )
        .returning()
    : [];

  const hostSpecs: HostSpec[] = opts.hosts ?? (opts.owner ? [{ userId: opts.owner.id }] : []);
  const hosts: EventTypeHostRow[] = hostSpecs.length
    ? await db
        .insert(eventTypeHosts)
        .values(
          hostSpecs.map((h, i) => {
            const poolIndex = h.poolIndex === undefined ? (eventType.poolingType === "round_robin" ? 0 : null) : h.poolIndex;
            const pool = poolIndex === null ? null : pools[poolIndex];
            if (poolIndex !== null && !pool) throw new Error(`createEventType: pool ${poolIndex} does not exist`);
            return {
              eventTypeId: eventType.id,
              userId: h.userId,
              poolId: pool?.id ?? null,
              priority: h.priority ?? 3,
              scheduleId: h.scheduleId ?? null,
              locationOverride: h.locationOverride ?? null,
              position: i,
            };
          }),
        )
        .returning()
    : [];

  const questions: EventTypeQuestionRow[] = opts.questions?.length
    ? await db
        .insert(eventTypeQuestions)
        .values(
          opts.questions.map((q, i) => ({
            eventTypeId: eventType.id,
            position: i,
            label: q.label,
            type: q.type ?? "text",
            required: q.required ?? false,
            enabled: q.enabled ?? true,
            answerChoices: q.answerChoices ?? [],
          })),
        )
        .returning()
    : [];

  return { eventType, hosts, pools, questions };
}
