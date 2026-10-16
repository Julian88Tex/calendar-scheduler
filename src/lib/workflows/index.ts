// Workflows public API (ARCHITECTURE sections 14 and 25; docs/SCOPE.md workflows lite: email reminders before
// meetings). Server only. Client code imports the pure helpers from their own files: @/lib/workflows/timing (offset
// labels and validation), @/lib/workflows/schemas (action inputs), @/lib/workflows/types (view types) and
// @/lib/workflows/engine (the timing rules).
//
// - Event type reminders (the event type editor's "Notifications and workflows" rows): getEventTypeReminders,
//   saveEventTypeReminders, setEventTypeRemindersEnabled (actions in ./actions.ts).
// - Engine: computeExecutions (NT-15), the domain event subscribers (./subscribers.ts) and the workflows.execute and
//   workflows.backfill jobs (./jobs.ts); enqueueBackfill applies a workflow to meetings already booked.
// - Delivery health: getReminderDeliveryHealth (cron freshness where cron dispatches jobs, overdue reminders), for
//   the dashboard warning and the reminders section.
import "server-only";

export type * from "./types";
export {
  computeExecutions,
  currentRunAt,
  executionIdempotencyKey,
  executionRunAt,
  stepSnapshot,
  TIMED_TRIGGERS,
  type ComputedExecution,
  type ComputeOptions,
  type EngineInvitee,
  type EngineMeeting,
  type EngineStep,
  type EngineWorkflow,
  type WorkflowAction,
  type WorkflowTrigger,
} from "./engine";
export { BACKFILL_PAGE_SIZE, backfillKey, enqueueBackfill, runBackfill, type BackfillOutcome } from "./backfill";
export { executeWorkflowJob, type ExecuteOutcome } from "./execute";
export { getReminderDeliveryHealth, OVERDUE_AFTER_MS, type ReminderDeliveryHealth } from "./health";
export {
  copyEventTypeReminders,
  getEventTypeReminders,
  reminderDefaults,
  saveEventTypeReminders,
  setEventTypeRemindersEnabled,
  type SaveRemindersResult,
} from "./reminders";
export { BASIC_REMINDER_KIND, HOST_REMINDER_TEMPLATE_KEY, MAX_WORKFLOWS_PER_USER, REMINDER_WORKFLOW_NAMES } from "./constants";
export { handleCancellation, handleNoShow, handleReschedule, scheduleForBooking } from "./schedule";
export { BACKFILL_JOB, cancelExecutions, EXECUTE_JOB, retimeExecutions, workflowsForEventType } from "./store";
