// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Job registry (ARCHITECTURE section 12.2): merges `handlers` and `periodic` from every module jobs.ts file, the
// foundation handlers (src/lib/jobs/builtin.ts: email.retry, sms.retry, system.cleanup) and the event dispatcher
// (`event:{type}:{subscriberKey}` jobs created by publishEvent). Loaded lazily by runDueJobs (import cycles: module
// jobs files call enqueueJob). A job type without a handler here is rescheduled by the runner (module not built yet).
import * as admin from "@/lib/admin/jobs";
import * as booking from "@/lib/booking/jobs";
import * as calendars from "@/lib/calendars/jobs";
import * as contacts from "@/lib/contacts/jobs";
import * as lifecycle from "@/lib/lifecycle/jobs";
import * as links from "@/lib/links/jobs";
import * as meetings from "@/lib/meetings/jobs";
import * as payments from "@/lib/payments/jobs";
import * as polls from "@/lib/polls/jobs";
import * as settings from "@/lib/settings/jobs";
import * as teams from "@/lib/teams/jobs";
import * as webhooks from "@/lib/webhooks/jobs";
import * as workflows from "@/lib/workflows/jobs";
import { log } from "../logger";
import { dispatchEventJob } from "../events/dispatch";
import * as builtin from "./builtin";
import type { JobHandler, JobHandlers, PeriodicJob } from "./types";

type JobsModule = { handlers: JobHandlers; periodic?: PeriodicJob[] };

/** Every module that contributes job handlers (key = module domain). */
export const JOB_MODULES: Record<string, JobsModule> = {
  foundation: builtin,
  calendars,
  lifecycle,
  workflows,
  webhooks,
  links,
  polls,
  payments,
  admin,
  contacts,
  meetings,
  booking,
  settings,
  teams,
};

function mergeHandlers(modules: Record<string, JobsModule>): JobHandlers {
  const out: JobHandlers = {};
  const owner: Record<string, string> = {};
  for (const [name, m] of Object.entries(modules)) {
    for (const [type, handler] of Object.entries(m.handlers ?? {})) {
      if (typeof handler !== "function") continue;
      if (owner[type]) {
        log.warn("jobs.duplicate_handler", { type, kept: owner[type], ignored: name });
        continue;
      }
      owner[type] = name;
      out[type] = handler;
    }
  }
  return out;
}

export const JOB_HANDLERS: Readonly<JobHandlers> = mergeHandlers(JOB_MODULES);

export const PERIODIC_JOBS: readonly PeriodicJob[] = Object.values(JOB_MODULES)
  .flatMap((m) => m.periodic ?? [])
  .filter((p) => p && typeof p.type === "string" && Number.isFinite(p.everyMinutes) && p.everyMinutes >= 1);

/** The handler for a job type, or null when no module registered one. */
export function getJobHandler(type: string): JobHandler | null {
  if (type.startsWith("event:")) return (payload, ctx) => dispatchEventJob(type, payload, ctx);
  return Object.prototype.hasOwnProperty.call(JOB_HANDLERS, type) ? (JOB_HANDLERS[type] ?? null) : null;
}

/** Every registered job type (admin filters). */
export function registeredJobTypes(): string[] {
  return Object.keys(JOB_HANDLERS).sort();
}
