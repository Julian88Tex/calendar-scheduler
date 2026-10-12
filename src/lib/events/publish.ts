// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// publishEvent (ARCHITECTURE section 12.1): inserts a domain_events row and one jobs row per subscriber key that handles
// the type: job type `event:{type}:{subscriberKey}`, payload { domainEventId, type, payload, meta }, idempotency key
// `{domainEventId}:{subscriberKey}`, priority 10. Call it inside the transaction of the state change (outbox pattern),
// then run the jobs with after(() => runDueJobs({ budgetMs: 8000, types: ["event:{type}:*"] })).
import "server-only";
import type { DbOrTx } from "@/db";
import { domainEvents } from "@/db/schema";
import { enqueueJob } from "../jobs";
import { now } from "../time/now";
import type { DomainEventMap, DomainEventMeta, DomainEventType } from "./types";

export type EventJobPayload<T extends DomainEventType = DomainEventType> = {
  domainEventId: string;
  type: T;
  payload: DomainEventMap[T];
  meta: DomainEventMeta;
};

/** Publishes a domain event; returns the domain event id. */
export async function publishEvent<T extends DomainEventType>(
  tx: DbOrTx,
  type: T,
  payload: DomainEventMap[T],
  meta: DomainEventMeta,
): Promise<string> {
  const [row] = await tx
    .insert(domainEvents)
    .values({
      type,
      organizationId: meta.organizationId,
      actor: meta.actor ?? null,
      payload: payload as unknown as Record<string, unknown>,
      occurredAt: now(),
    })
    .returning({ id: domainEvents.id });
  if (!row) throw new Error("publishEvent: insert returned no row");
  const { subscriberKeysFor } = await import("./registry");
  for (const key of subscriberKeysFor(type)) {
    const jobPayload: EventJobPayload<T> = { domainEventId: row.id, type, payload, meta };
    await enqueueJob(tx, {
      type: `event:${type}:${key}`,
      payload: jobPayload,
      idempotencyKey: `${row.id}:${key}`,
      priority: 10,
    });
  }
  return row.id;
}
