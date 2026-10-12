// OWNER: polls-core. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Job handlers of this module, merged by src/lib/jobs/registry.ts (ARCHITECTURE section 12.2). Keys are prefixed with
// the module domain. Planned types: polls.deadline, polls.deadline_warning, polls.expire, polls.reminder, polls.digest, polls.holds_sync, polls.notify, polls.purge.
// A job enqueued for a type that has no handler yet is rescheduled one hour later (last_error 'no_handler').
import type { JobHandlers, PeriodicJob } from "@/lib/jobs/types";

export const handlers: JobHandlers = {};
export const periodic: PeriodicJob[] = [];
