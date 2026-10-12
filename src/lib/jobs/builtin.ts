// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Foundation job handlers (ARCHITECTURE section 12.2): email.retry, sms.retry and system.cleanup (daily, GEN-16
// retention), merged by src/lib/jobs/registry.ts. Implementations live in builtin-handlers.ts.
import { builtinHandlers, builtinPeriodic } from "./builtin-handlers";
import type { JobHandlers, PeriodicJob } from "./types";

export const handlers: JobHandlers = builtinHandlers;

export const periodic: PeriodicJob[] = builtinPeriodic;
