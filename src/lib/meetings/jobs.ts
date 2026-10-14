// OWNER: meetings-dashboard.
//
// Job handlers of this module, merged by src/lib/jobs/registry.ts (ARCHITECTURE section 12.2). None: the CSV export
// (SPEC MT-11) streams from GET /api/meetings/export instead of running a meetings.export job (docs/SCOPE.md keeps the
// export only as a simple route handler; one person's meetings fit a streamed response).
import type { JobHandlers, PeriodicJob } from "@/lib/jobs/types";

export const handlers: JobHandlers = {};
export const periodic: PeriodicJob[] = [];
