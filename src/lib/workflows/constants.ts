// Shared constants of the workflows module (no runtime dependencies: safe for the seed script and client code).
import type { ReminderKind } from "./types";

/** workflows.template_key of the per event type "Email reminder to host" rows (reminders.ts). */
export const HOST_REMINDER_TEMPLATE_KEY = "event_type_host_reminder";
/** workflows.template_key of the basic "Email reminders" rows. */
export const BASIC_REMINDER_TEMPLATE_KEY = "basic_email_reminder";
/** workflows.basic_kind of the basic "Email reminders" rows. */
export const BASIC_REMINDER_KIND = "email_reminder" as const;
/** NT-24: up to 50 workflows per user (basic notifications do not count). */
export const MAX_WORKFLOWS_PER_USER = 50;

/** Workflow names (shown in the meeting activity log). */
export const REMINDER_WORKFLOW_NAMES: Record<ReminderKind, string> = {
  invitee: "Email reminder to invitees",
  host: "Email reminder to host",
};
