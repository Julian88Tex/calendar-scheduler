// Reminder delivery health (SPEC GEN-16, NT-11, NT-23; docs/SCOPE.md priority 5): overdue reminders per
// organization, and the cron freshness rule where cron is the dispatcher.
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { instanceSettings, jobs, workflowExecutions } from "@/db/schema";
import { now, resetFakeTime } from "@/lib/time/now";
import { getReminderDeliveryHealth } from "@/lib/workflows/health";
import { setEventTypeRemindersEnabled } from "@/lib/workflows/reminders";
import { useTestDb } from "../helpers/db";
import { book, DAY, jobOf, MINUTE, runWorkflowJobs, scheduledFor, setupOwner } from "./helpers";

const t = useTestDb();

afterEach(() => {
  resetFakeTime();
  vi.unstubAllEnvs();
});

async function setLastCron(at: Date | null) {
  await t.db.delete(instanceSettings).where(eq(instanceSettings.key, "last_cron_at"));
  if (at) await t.db.insert(instanceSettings).values({ key: "last_cron_at", value: at.toISOString() });
}

describe("getReminderDeliveryHealth", () => {
  it("self-hosted (poller): no cron warning; overdue reminders still warn, scoped to the organization", async () => {
    await setLastCron(null);
    const { actor, eventType } = await setupOwner(t.db);
    const other = await setupOwner(t.db);
    const m = await book(t.db, eventType, 3 * DAY);
    await setEventTypeRemindersEnabled(actor, { eventTypeId: eventType.id, kind: "invitee", enabled: true }, t.db);
    await runWorkflowJobs(t.db);
    const healthy = await getReminderDeliveryHealth({ organizationId: actor.orgId, db: t.db });
    expect(healthy).toMatchObject({ dispatcher: "poller", cronStale: false, overdueCount: 0, warning: false });

    const [e] = await scheduledFor(t.db, m.invitee!.id);
    await t.db.update(workflowExecutions).set({ runAt: new Date(now().getTime() - 20 * MINUTE) }).where(eq(workflowExecutions.id, e!.id));
    const overdue = await getReminderDeliveryHealth({ organizationId: actor.orgId, db: t.db });
    expect(overdue).toMatchObject({ overdueCount: 1, warning: true });
    expect(overdue.oldestOverdueAt).not.toBeNull();
    expect(await getReminderDeliveryHealth({ organizationId: other.actor.orgId, db: t.db })).toMatchObject({ overdueCount: 0, warning: false });
    // Ten minutes late is not overdue yet.
    await t.db.update(workflowExecutions).set({ runAt: new Date(now().getTime() - 10 * MINUTE) }).where(eq(workflowExecutions.id, e!.id));
    expect((await getReminderDeliveryHealth({ organizationId: actor.orgId, db: t.db })).overdueCount).toBe(0);
  });

  it("counts only reminders still waiting for the dispatcher, so dead or canceled jobs never keep the warning on", async () => {
    await setLastCron(null);
    const { actor, eventType } = await setupOwner(t.db);
    const m = await book(t.db, eventType, 3 * DAY);
    await setEventTypeRemindersEnabled(actor, { eventTypeId: eventType.id, kind: "invitee", enabled: true }, t.db);
    await runWorkflowJobs(t.db);
    const [e] = await scheduledFor(t.db, m.invitee!.id);
    const past = new Date(now().getTime() - 2 * 60 * MINUTE);
    await t.db.update(workflowExecutions).set({ runAt: past }).where(eq(workflowExecutions.id, e!.id));
    const job = await jobOf(t.db, e!.id);
    // The dispatcher has not picked the job up: overdue.
    await t.db.update(jobs).set({ runAt: past }).where(eq(jobs.id, job!.id));
    expect(await getReminderDeliveryHealth({ organizationId: actor.orgId, db: t.db })).toMatchObject({ overdueCount: 1, warning: true });
    // The job is retrying after a failure (its next try is later): still a late reminder.
    await t.db.update(jobs).set({ runAt: new Date(now().getTime() + 30 * MINUTE), attempts: 2 }).where(eq(jobs.id, job!.id));
    expect((await getReminderDeliveryHealth({ organizationId: actor.orgId, db: t.db })).overdueCount).toBe(1);
    // A job that ran out of attempts, was canceled elsewhere, or was purged will never dispatch: not "late".
    for (const status of ["dead", "canceled", "succeeded"] as const) {
      await t.db.update(jobs).set({ status }).where(eq(jobs.id, job!.id));
      expect(await getReminderDeliveryHealth({ organizationId: actor.orgId, db: t.db })).toMatchObject({ overdueCount: 0, warning: false });
    }
    await t.db.delete(jobs).where(eq(jobs.id, job!.id));
    expect((await getReminderDeliveryHealth({ db: t.db })).overdueCount).toBe(0);
  });

  it("where cron dispatches jobs, a tick older than 15 minutes warns", async () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    await setLastCron(new Date(now().getTime() - 20 * MINUTE));
    expect(await getReminderDeliveryHealth({ db: t.db })).toMatchObject({ dispatcher: "cron", cronStale: true, warning: true });
    await setLastCron(new Date(now().getTime() - 2 * MINUTE));
    expect(await getReminderDeliveryHealth({ db: t.db })).toMatchObject({ dispatcher: "cron", cronStale: false });
  });
});
