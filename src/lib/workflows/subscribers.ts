// OWNER: workflows. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Domain event subscribers of this module, registered in src/lib/events/registry.ts under the key "workflows"
// (ARCHITECTURE section 12.1). publishEvent creates one job per subscriber key that handles the type, so an empty map
// creates no jobs. Planned: booking.created, booking.canceled, booking.rescheduled, booking.no_show_created, booking.reconfirmed.
import type { SubscriberMap } from "@/lib/events/types";

export const subscribers: SubscriberMap = {};
