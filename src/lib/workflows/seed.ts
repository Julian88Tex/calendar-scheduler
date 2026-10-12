// OWNER: workflows.
//
// Demo data for `npm run db:seed -- --demo` (SPEC ADM-10): the "Email reminders" basic notification, 24 hours before
// the event, on every demo event type, inside the seed transaction, then a backfill so the demo meetings that are
// already booked get their reminders. Idempotent: re-running keeps one live reminder per event type (reviving or
// re-enabling it), re-times scheduled reminders of meetings the seed moved, and never duplicates executions.
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { eventTypes, workflowExecutions, workflowSteps, workflows } from "@/db/schema";
import { now as clockNow } from "@/lib/time/now";
import { enqueueBackfill } from "./backfill";
import { BASIC_REMINDER_KIND, BASIC_REMINDER_TEMPLATE_KEY, REMINDER_WORKFLOW_NAMES } from "./constants";
import { retimeExecutions } from "./store";
import { DEFAULT_REMINDER_OFFSET_MINUTES } from "./timing";

export type SeedDemoContext = {
  ownerUserId: string;
  /** The owner's organization. */
  organizationId?: string;
  /** The seeded owner event types (30min, 60min, meal). */
  eventTypeIds: string[];
};

export async function seedDemo(tx: DbOrTx, ctx: SeedDemoContext): Promise<void> {
  if (!ctx.eventTypeIds.length) return;
  const at = clockNow();
  const types = await tx
    .select({ id: eventTypes.id, organizationId: eventTypes.organizationId, includeLinks: eventTypes.includeCancelRescheduleLinks })
    .from(eventTypes)
    .where(and(inArray(eventTypes.id, ctx.eventTypeIds), isNull(eventTypes.deletedAt)));
  const workflowIds: string[] = [];
  for (const et of types) {
    const [existing] = await tx
      .select({ id: workflows.id })
      .from(workflows)
      .where(
        and(
          eq(workflows.isBasic, true),
          eq(workflows.basicEventTypeId, et.id),
          eq(workflows.basicKind, BASIC_REMINDER_KIND),
          eq(workflows.offsetMinutes, DEFAULT_REMINDER_OFFSET_MINUTES),
          isNull(workflows.deletedAt),
        ),
      )
      .limit(1);
    let workflowId = existing?.id;
    if (workflowId) {
      await tx.update(workflows).set({ active: true, updatedAt: at }).where(eq(workflows.id, workflowId));
    } else {
      const [created] = await tx
        .insert(workflows)
        .values({
          organizationId: ctx.organizationId ?? et.organizationId,
          ownerUserId: ctx.ownerUserId,
          scope: "user",
          name: REMINDER_WORKFLOW_NAMES.invitee,
          trigger: "before_start",
          offsetMinutes: DEFAULT_REMINDER_OFFSET_MINUTES,
          active: true,
          isBasic: true,
          basicKind: BASIC_REMINDER_KIND,
          basicEventTypeId: et.id,
          templateKey: BASIC_REMINDER_TEMPLATE_KEY,
          createdAt: at,
          updatedAt: at,
        })
        .returning({ id: workflows.id });
      if (!created) throw new Error("[seed] workflow insert returned no row");
      workflowId = created.id;
    }
    const [step] = await tx.select({ id: workflowSteps.id }).from(workflowSteps).where(eq(workflowSteps.workflowId, workflowId)).limit(1);
    if (!step) {
      await tx.insert(workflowSteps).values({
        workflowId,
        position: 0,
        action: "email_invitees",
        recipients: [],
        subject: null,
        bodyHtml: null,
        includeCancelRescheduleLinks: et.includeLinks,
        includeGuests: false,
        createdAt: at,
        updatedAt: at,
      });
    }
    workflowIds.push(workflowId);
    await enqueueBackfill(tx, { workflowId, eventTypeIds: [et.id], version: at });
  }
  // The seed updates demo meetings in place (same ids, new times): follow them.
  if (workflowIds.length) await retimeExecutions(tx, inArray(workflowExecutions.workflowId, workflowIds));
}
