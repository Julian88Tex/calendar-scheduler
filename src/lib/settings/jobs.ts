// OWNER: settings-onboarding.
//
// Job handlers of this module, merged by src/lib/jobs/registry.ts (ARCHITECTURE section 12.2). The settings kept by
// docs/SCOPE.md (Profile, Branding, My Link, Login and security) all apply synchronously, so the module registers no
// jobs: the Calendly import and account deletion jobs belong to features docs/SCOPE.md does not build.
import type { JobHandlers, PeriodicJob } from "@/lib/jobs/types";

export const handlers: JobHandlers = {};
export const periodic: PeriodicJob[] = [];
