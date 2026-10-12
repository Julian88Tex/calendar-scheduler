// OWNER: calendar-integrations. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Job handlers of this module, merged by src/lib/jobs/registry.ts (ARCHITECTURE section 12.2). Keys are prefixed with
// the module domain. Planned types: calendars.sync_booked_events (periodic, every 10 minutes, CAL-14), calendars.refresh_ics, calendars.linked_event_retry.
// A job enqueued for a type that has no handler yet is rescheduled one hour later (last_error 'no_handler').
import type { JobHandlers, PeriodicJob } from "@/lib/jobs/types";

export const handlers: JobHandlers = {};
export const periodic: PeriodicJob[] = [];
