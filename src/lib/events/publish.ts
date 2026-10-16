// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// publishEvent (ARCHITECTURE section 12.1): inserts a domain_events row and one jobs row per subscriber key that handles
// the type: job type `event:{type}:{subscriberKey}`, payload { domainEventId, type, payload, meta }, idempotency key
// `{domainEventId}:{subscriberKey}`, priority 10. Call it inside the transaction of the state change (outbox pattern:
// the event and its jobs commit or roll back with the change), then run the jobs right after the response:
//
//   await db.transaction(async (tx) => { ...; await publishEvent(tx, "booking.created", payload, meta); });
//   runJobsAfterResponse({ types: [eventJobPattern("booking.created")] });
import "server-only";
import type { DbOrTx } from "@/db";
import { domainEvents } from "@/db/schema";
import { enqueueJobs } from "../jobs/queue";
import { now } from "../time/now";
import { DOMAIN_EVENT_TYPES, type DomainEventMap, type DomainEventMeta, type DomainEventType } from "./types";

export type EventJobPayload<T extends DomainEventType = DomainEventType> = {
  domainEventId: string;
  type: T;
  payload: DomainEventMap[T];
  meta: DomainEventMeta;
};

const KNOWN = new Set<string>(DOMAIN_EVENT_TYPES);

/** Job priority of event subscriber jobs (above ordinary jobs: they carry the immediate side effects). */
export const EVENT_JOB_PRIORITY = 10;

/** The runner filter matching every subscriber job of an event type ("event:booking.created:*"). */
export function eventJobPattern(type: DomainEventType): string {
  return `event:${type}:*`;
}

/** Publishes a domain event; returns the domain event id. */
export async function publishEvent<T extends DomainEventType>(
  tx: DbOrTx,
  type: T,
  payload: DomainEventMap[T],
  meta: DomainEventMeta,
): Promise<string> {
  if (!KNOWN.has(type)) throw new Error(`publishEvent: unknown event type ${String(type)}`);
  const cleanMeta: DomainEventMeta = { organizationId: meta?.organizationId ?? null, ...(meta?.actor ? { actor: meta.actor } : {}) };
  const [row] = await tx
    .insert(domainEvents)
    .values({
      type,
      organizationId: cleanMeta.organizationId,
      actor: cleanMeta.actor ?? null,
      payload: payload as unknown as Record<string, unknown>,
      occurredAt: now(),
    })
    .returning({ id: domainEvents.id });
  if (!row) throw new Error("publishEvent: insert returned no row");
  const { subscriberKeysFor } = await import("./registry");
  const keys = subscriberKeysFor(type);
  if (keys.length) {
    const jobPayload: EventJobPayload<T> = { domainEventId: row.id, type, payload, meta: cleanMeta };
    await enqueueJobs(
      tx,
      keys.map((key) => ({
        type: `event:${type}:${key}`,
        payload: jobPayload,
        idempotencyKey: `${row.id}:${key}`,
        priority: EVENT_JOB_PRIORITY,
      })),
    );
  }
  return row.id;
}
