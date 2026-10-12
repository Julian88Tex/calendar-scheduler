// OWNER: lifecycle-core.
//
// Job handlers of this module, merged by src/lib/jobs/registry.ts (ARCHITECTURE section 12.2): lifecycle.provision_retry
// (calendar write retries with the CAL-12 fallback, pending Meet links), lifecycle.meeting_moved (in-place move side
// effects, MP-21), lifecycle.request_reschedule_reminder (CR-08) and lifecycle.cancel_user_meetings (payload
// { userId, scope: "sole_host" | "all_hosted", reason }, AU-15, TM-04). See job-handlers.ts.
import type { JobHandlers, PeriodicJob } from "@/lib/jobs/types";
import { lifecycleJobHandlers } from "./job-handlers";

export const handlers: JobHandlers = lifecycleJobHandlers;
export const periodic: PeriodicJob[] = [];
