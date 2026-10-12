// Workflows (automations) with steps and event type links.
import type { DbOrTx } from "@/db";
import { workflowEventTypes, workflowSteps, workflows } from "@/db/schema";
import { one } from "./_util";
import type { TestUser } from "./users";

export type WorkflowRow = typeof workflows.$inferSelect;

export async function createWorkflow(
  db: DbOrTx,
  opts: {
    owner: TestUser;
    name?: string;
    trigger?: WorkflowRow["trigger"];
    offsetMinutes?: number;
    active?: boolean;
    eventTypeIds?: string[];
    steps?: {
      action?: (typeof workflowSteps.$inferInsert)["action"];
      subject?: string | null;
      bodyHtml?: string | null;
      bodyText?: string | null;
      recipients?: string[];
    }[];
    overrides?: Partial<typeof workflows.$inferInsert>;
  },
) {
  const workflow = one(
    await db
      .insert(workflows)
      .values({
        organizationId: opts.owner.organizationId,
        ownerUserId: opts.owner.id,
        name: opts.name ?? "Email reminder to invitees",
        trigger: opts.trigger ?? "before_start",
        offsetMinutes: opts.offsetMinutes ?? 1440,
        active: opts.active ?? true,
        ...opts.overrides,
      })
      .returning(),
    "workflow",
  );
  const stepSpecs = opts.steps ?? [
    { action: "email_invitees" as const, subject: "Reminder: {{event_name}}", bodyHtml: "<p>See you soon.</p>" },
  ];
  const steps = stepSpecs.length
    ? await db
        .insert(workflowSteps)
        .values(
          stepSpecs.map((s, i) => ({
            workflowId: workflow.id,
            position: i,
            action: s.action ?? "email_invitees",
            subject: s.subject ?? null,
            bodyHtml: s.bodyHtml ?? null,
            bodyText: s.bodyText ?? null,
            recipients: s.recipients ?? [],
          })),
        )
        .returning()
    : [];
  if (opts.eventTypeIds?.length) {
    await db
      .insert(workflowEventTypes)
      .values(opts.eventTypeIds.map((eventTypeId) => ({ workflowId: workflow.id, eventTypeId })));
  }
  return { workflow, steps };
}
