// OWNER: lifecycle-core. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Domain event subscribers of this module, registered in src/lib/events/registry.ts under the key "lifecycle"
// (ARCHITECTURE section 12.1). publishEvent creates one job per subscriber key that handles the type, so an empty map
// creates no jobs. Planned: booking.created (provision then notify), booking.canceled, booking.rescheduled, booking.host_reassigned, meeting.updated.
import type { SubscriberMap } from "@/lib/events/types";

export const subscribers: SubscriberMap = {};
