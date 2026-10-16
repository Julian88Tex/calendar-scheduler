// OWNER: workflows.
//
// Job handlers of this module, merged by src/lib/jobs/registry.ts (ARCHITECTURE section 12.2): workflows.execute
// { executionId } sends one scheduled reminder; workflows.backfill { workflowId, eventTypeIds } applies a workflow to
// meetings already booked (job-handlers.ts). No periodic jobs: the daily agenda email (NT-22) is not part of this build
// (docs/SCOPE.md).
import type { JobHandlers, PeriodicJob } from "@/lib/jobs/types";
import { workflowJobHandlers } from "./job-handlers";

export const handlers: JobHandlers = workflowJobHandlers;
export const periodic: PeriodicJob[] = [];
