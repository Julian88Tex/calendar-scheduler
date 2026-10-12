// Job handlers of the workflow engine (ARCHITECTURE section 12.2), re-exported by the contract file jobs.ts:
// - workflows.execute { executionId }: sends one scheduled reminder after re-checking it (execute.ts);
// - workflows.backfill { workflowId, eventTypeIds?, cursor? }: applies a workflow to meetings already booked
//   (backfill.ts).
import "server-only";
import type { JobHandlers } from "@/lib/jobs/types";
import { runBackfill } from "./backfill";
import { executeWorkflowJob } from "./execute";
import { BACKFILL_JOB, EXECUTE_JOB } from "./store";

export const workflowJobHandlers: JobHandlers = {
  [EXECUTE_JOB]: executeWorkflowJob,
  [BACKFILL_JOB]: runBackfill,
};
