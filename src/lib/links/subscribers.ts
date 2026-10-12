// OWNER: links-sharing. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Domain event subscribers of this module, registered in src/lib/events/registry.ts under the key "links"
// (ARCHITECTURE section 12.1). publishEvent creates one job per subscriber key that handles the type, so an empty map
// creates no jobs. Planned: booking.created (clear one-off holds, mark shares booked), booking.canceled.
import type { SubscriberMap } from "@/lib/events/types";

export const subscribers: SubscriberMap = {};
