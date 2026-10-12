// Shared fixtures of the workflows integration tests (PGlite): an owner with a solo event type, bookings relative to
// the business clock, the workflow jobs runner (the real claim and outcome logic of src/lib/jobs/runner.ts with this
// module's handlers) and small readers.
import { and, asc, eq, type SQL } from "drizzle-orm";
import type { DB } from "@/db";
import { emailOutbox, jobs, meetingActivity, workflowExecutions } from "@/db/schema";
import { loadActorCtx, type ActorCtx } from "@/lib/authz";
import { claimNextJob, executeJob, jobFilter } from "@/lib/jobs/runner";
import { now } from "@/lib/time/now";
import { workflowJobHandlers } from "@/lib/workflows/job-handlers";
import * as f from "../factories";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** A time relative to the business clock. */
export const fromNow = (ms: number): Date => new Date(now().getTime() + ms);

/** An instant rounded to the minute (stable run time comparisons). */
export const minuteAligned = (d: Date): Date => new Date(Math.floor(d.getTime() / MINUTE) * MINUTE);

export type OwnerFixture = {
  owner: f.TestUser;
  actor: ActorCtx;
  eventType: f.EventTypeRow;
};

/** An owner (Pacific time) with a 30 minute solo event type. */
export async function setupOwner(db: DB, opts: { name?: string; eventType?: Partial<f.CreateEventTypeOptions> } = {}): Promise<OwnerFixture> {
  const owner = await f.createUser(db, { name: opts.name ?? "Julian Joseph", timezone: "America/Los_Angeles" });
  const { eventType } = await f.createEventType(db, { owner, name: "30 Minute Virtual", durationMinutes: 30, ...opts.eventType });
  const actor = await loadActorCtx(db, owner);
  return { owner, actor, eventType };
}

/** A booking starting `startInMs` from now (minute aligned). */
export async function book(
  db: DB,
  eventType: f.EventTypeRow,
  startInMs: number,
  invitee: f.InviteeSpec = {},
  extra: Partial<f.CreateBookingOptions> = {},
) {
  const start = minuteAligned(fromNow(startInMs));
  return f.createBooking(db, {
    eventType,
    start,
    invitee: { name: "Sam Rivera", email: `sam.${f.uniq("r")}@example.com`, timezone: "America/New_York", ...invitee },
    ...extra,
  });
}

/** Runs due workflows.* jobs with the real runner semantics until none is due. Returns the number run. */
export async function runWorkflowJobs(db: DB, opts: { max?: number } = {}): Promise<number> {
  const filter = jobFilter({ types: ["workflows.*"] });
  let n = 0;
  for (;;) {
    const job = await claimNextJob(db, "test-worker", filter);
    if (!job) return n;
    await executeJob(db, job, workflowJobHandlers[job.type] ?? null, "test-worker");
    n++;
    if (n > (opts.max ?? 2_000)) throw new Error("runWorkflowJobs: too many jobs");
  }
}

export async function executionsWhere(db: DB, where?: SQL) {
  return db.select().from(workflowExecutions).where(where).orderBy(asc(workflowExecutions.runAt), asc(workflowExecutions.createdAt));
}

export async function scheduledFor(db: DB, inviteeId: string) {
  return executionsWhere(db, and(eq(workflowExecutions.inviteeId, inviteeId), eq(workflowExecutions.status, "scheduled")));
}

export async function jobOf(db: DB, executionId: string) {
  const [row] = await db.select().from(jobs).where(eq(jobs.idempotencyKey, `workflows.execute:${executionId}`)).limit(1);
  return row ?? null;
}

export async function outboxFor(db: DB, executionId: string) {
  return db.select().from(emailOutbox).where(eq(emailOutbox.workflowExecutionId, executionId)).orderBy(asc(emailOutbox.createdAt));
}

export async function activityOf(db: DB, scheduledEventId: string) {
  return db.select().from(meetingActivity).where(eq(meetingActivity.scheduledEventId, scheduledEventId)).orderBy(asc(meetingActivity.createdAt));
}

/** The event payload shape the dispatcher passes to subscribers. */
export function domainEvent<T>(type: string, payload: T) {
  return { id: f.newId(), type, payload, meta: { organizationId: null } } as never;
}

/** A JobContext for calling subscribers and handlers directly. */
export function jobCtx(db: DB) {
  const log = { debug() {}, info() {}, warn() {}, error() {}, child() { return log; } };
  return { db, jobId: f.newId(), attempt: 1, now: now(), log } as never;
}
