// OWNER: webhooks-embed. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Domain event subscribers of this module, registered in src/lib/events/registry.ts under the key "webhooks"
// (ARCHITECTURE section 12.1). publishEvent creates one job per subscriber key that handles the type, so an empty map
// creates no jobs. Planned: every type that maps to a webhook event (API-08).
import type { SubscriberMap } from "@/lib/events/types";

export const subscribers: SubscriberMap = {};
