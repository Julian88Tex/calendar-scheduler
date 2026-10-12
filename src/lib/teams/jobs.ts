// OWNER: teams-org. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Job handlers of this module, merged by src/lib/jobs/registry.ts (ARCHITECTURE section 12.2). Keys are prefixed with
// the module domain. Planned types: teams.disband_org.
// A job enqueued for a type that has no handler yet is rescheduled one hour later (last_error 'no_handler').
import type { JobHandlers, PeriodicJob } from "@/lib/jobs/types";

export const handlers: JobHandlers = {};
export const periodic: PeriodicJob[] = [];
