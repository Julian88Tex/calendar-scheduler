// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Static subscriber registry (ARCHITECTURE section 12.1): one key per module subscriber file. publishEvent creates
// one job `event:{type}:{key}` per key whose map handles the type; the event dispatcher job (src/lib/jobs/registry.ts)
// calls the handler. Loaded lazily by publishEvent and the jobs runner to keep module import graphs acyclic.
import { subscribers as analytics } from "@/lib/analytics/subscribers";
import { subscribers as contacts } from "@/lib/contacts/subscribers";
import { subscribers as lifecycle } from "@/lib/lifecycle/subscribers";
import { subscribers as links } from "@/lib/links/subscribers";
import { subscribers as payments } from "@/lib/payments/subscribers";
import { subscribers as polls } from "@/lib/polls/subscribers";
import { subscribers as routing } from "@/lib/routing/subscribers";
import { subscribers as webhooks } from "@/lib/webhooks/subscribers";
import { subscribers as workflows } from "@/lib/workflows/subscribers";
import type { DomainEventType, SubscriberHandler, SubscriberMap } from "./types";

export const SUBSCRIBER_REGISTRY = {
  lifecycle,
  workflows,
  webhooks,
  contacts,
  links,
  polls,
  analytics,
  payments,
  routing,
} satisfies Record<string, SubscriberMap>;

export type SubscriberKey = keyof typeof SUBSCRIBER_REGISTRY;

export const SUBSCRIBER_KEYS = Object.keys(SUBSCRIBER_REGISTRY) as SubscriberKey[];

export function isSubscriberKey(key: string): key is SubscriberKey {
  return Object.prototype.hasOwnProperty.call(SUBSCRIBER_REGISTRY, key);
}

/** Subscriber keys whose map handles `type` (in registry order). */
export function subscriberKeysFor(type: DomainEventType): SubscriberKey[] {
  return SUBSCRIBER_KEYS.filter((key) => typeof (SUBSCRIBER_REGISTRY[key] as SubscriberMap)[type] === "function");
}

/** The handler of one subscriber for one event type, or null. */
export function getSubscriber<T extends DomainEventType>(key: string, type: T): SubscriberHandler<T> | null {
  if (!isSubscriberKey(key)) return null;
  const handler = (SUBSCRIBER_REGISTRY[key] as SubscriberMap)[type];
  return typeof handler === "function" ? (handler as SubscriberHandler<T>) : null;
}
