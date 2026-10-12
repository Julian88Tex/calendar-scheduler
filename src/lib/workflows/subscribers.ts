// OWNER: workflows.
//
// Domain event subscribers of this module, registered in src/lib/events/registry.ts under the key "workflows"
// (ARCHITECTURE section 12.1). publishEvent creates one job per subscriber key that handles the type:
// booking.created, booking.canceled, booking.rescheduled and booking.no_show_created schedule, cancel and re-time
// workflow executions (subscriber-handlers.ts). booking.reconfirmed is not handled: reconfirmation is not part of
// this build (docs/SCOPE.md).
import type { SubscriberMap } from "@/lib/events/types";
import { workflowSubscribers } from "./subscriber-handlers";

export const subscribers: SubscriberMap = workflowSubscribers;
