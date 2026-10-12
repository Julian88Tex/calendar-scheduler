// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// The event dispatcher job handler (ARCHITECTURE section 12.1): a job `event:{type}:{subscriberKey}` runs the
// subscriber registered under that key for that event type with the published payload. A subscriber that no longer
// handles the type makes the job a no-op; a malformed payload is a permanent failure (never retried).
import { PermanentJobError, type JobContext } from "../jobs/types";
import { getSubscriber } from "./registry";
import type { DomainEventMeta, DomainEventType } from "./types";
import { DOMAIN_EVENT_TYPES } from "./types";

const KNOWN = new Set<string>(DOMAIN_EVENT_TYPES);

/** Splits "event:booking.created:lifecycle" into its type and subscriber key (null when malformed). */
export function parseEventJobType(jobType: string): { type: DomainEventType; key: string } | null {
  const m = /^event:([a-z_]+\.[a-z_]+):([a-z_]+)$/.exec(jobType);
  if (!m || !KNOWN.has(m[1]!)) return null;
  return { type: m[1] as DomainEventType, key: m[2]! };
}

/** Runs one subscriber for one domain event. */
export async function dispatchEventJob(jobType: string, payload: unknown, ctx: JobContext): Promise<void> {
  const parsed = parseEventJobType(jobType);
  if (!parsed) throw new PermanentJobError(`Unknown event job type ${jobType}`);
  const p = (payload ?? {}) as { domainEventId?: unknown; type?: unknown; payload?: unknown; meta?: unknown };
  if (typeof p.domainEventId !== "string" || (p.type !== undefined && p.type !== parsed.type)) {
    throw new PermanentJobError(`Malformed payload for ${jobType}`);
  }
  const handler = getSubscriber(parsed.key, parsed.type);
  if (!handler) return; // the module no longer subscribes: nothing to do
  const meta = (p.meta && typeof p.meta === "object" ? p.meta : { organizationId: null }) as DomainEventMeta;
  await handler({ id: p.domainEventId, type: parsed.type, payload: (p.payload ?? {}) as never, meta }, ctx);
}
