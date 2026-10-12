// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Job registry (ARCHITECTURE section 12.2): merges `handlers` and `periodic` from every module jobs.ts file, the
// foundation handlers (src/lib/jobs/builtin.ts) and the event dispatcher (`event:{type}:{subscriberKey}` jobs created by
// publishEvent). Loaded lazily by runDueJobs (import cycles: module jobs files call enqueueJob).
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
import { getSubscriber } from "../events/registry";
import type { DomainEventType } from "../events/types";
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

export const JOB_HANDLERS: Readonly<JobHandlers> = Object.assign(
  {},
  ...Object.values(JOB_MODULES).map((m) => m.handlers),
) as JobHandlers;

export const PERIODIC_JOBS: readonly PeriodicJob[] = Object.values(JOB_MODULES).flatMap((m) => m.periodic ?? []);

/** Runs one subscriber for one domain event (job type `event:{type}:{subscriberKey}`). */
async function dispatchEvent(jobType: string, payload: unknown, ctx: Parameters<JobHandler>[1]): Promise<void> {
  const p = payload as { domainEventId: string; type: DomainEventType; payload: unknown; meta: { organizationId: string | null } };
  const key = jobType.split(":")[2] ?? "";
  const handler = getSubscriber(key, p.type);
  if (!handler) return; // the module no longer subscribes: nothing to do
  await handler({ id: p.domainEventId, type: p.type, payload: p.payload as never, meta: p.meta }, ctx);
}

/** The handler for a job type, or null when no module registered one. */
export function getJobHandler(type: string): JobHandler | null {
  if (type.startsWith("event:")) return (payload, ctx) => dispatchEvent(type, payload, ctx);
  return JOB_HANDLERS[type] ?? null;
}
