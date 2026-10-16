// OWNER: polls-core.
//
// Domain event subscribers of this module, registered in src/lib/events/registry.ts under the key "polls"
// (ARCHITECTURE section 12.1): booking.canceled on a poll meeting (the results page shows "Meeting canceled" with
// "Reopen poll", the activity feed records it, pending meeting reminders are canceled). See subscriber-handlers.ts.
import type { SubscriberMap } from "@/lib/events/types";
import { pollSubscribers } from "./subscriber-handlers";

export const subscribers: SubscriberMap = pollSubscribers;
