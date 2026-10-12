// OWNER: lifecycle-core.
//
// Domain event subscribers of this module, registered in src/lib/events/registry.ts under the key "lifecycle"
// (ARCHITECTURE section 12.1). publishEvent creates one job per subscriber key that handles the type:
// booking.created (provision then notify), booking.canceled (calendar delete, cancellation emails), booking.rescheduled
// (provider event moved, reschedule emails) and meeting.updated (invitee limit, location and buffer changes reach the
// provider events). See subscriber-handlers.ts. booking.host_reassigned is not handled: round robin is not part of
// this build (docs/SCOPE.md).
import type { SubscriberMap } from "@/lib/events/types";
import { lifecycleSubscribers } from "./subscriber-handlers";

export const subscribers: SubscriberMap = lifecycleSubscribers;
