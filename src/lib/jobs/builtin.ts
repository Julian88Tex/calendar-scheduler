// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Foundation job handlers (ARCHITECTURE section 12.2): email.retry, sms.retry and system.cleanup (daily, GEN-16
// retention). Stubs: no-ops until foundation-platform implements retries and the retention rules.
import type { JobHandlers, PeriodicJob } from "./types";

export const handlers: JobHandlers = {
  "email.retry": async () => {},
  "sms.retry": async () => {},
  "system.cleanup": async () => {},
};

export const periodic: PeriodicJob[] = [{ type: "system.cleanup", everyMinutes: 24 * 60 }];
