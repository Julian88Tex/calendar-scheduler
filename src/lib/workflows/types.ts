// View types of the event type reminders section (SPEC NT-09, ET-25), shared by the server service (reminders.ts)
// and the client component (src/components/workflows). Type-only module: safe to import from client code.

/** "invitee": the basic "Email reminders" notification; "host": "Email reminders to host" (Email reminder to host). */
export type ReminderKind = "invitee" | "host";

export type ReminderRowView = {
  kind: ReminderKind;
  /** On (every timing of the row shares the flag). */
  enabled: boolean;
  /** At least one timing exists (it was set up at some point). */
  configured: boolean;
  /** Offsets in minutes before the start, earliest reminder first. */
  offsets: number[];
  /** null = the default subject (rendered in the recipient's language at send time). */
  subject: string | null;
  /** null = the default message (greeting, reminder sentence and the event details blocks). */
  bodyHtml: string | null;
  /** Invitee reminders: the "Need to make changes to this event?" Cancel and Reschedule links. */
  includeCancelRescheduleLinks: boolean;
  /** Upcoming meetings with a reminder of this row scheduled. */
  scheduledMeetings: number;
};

export type ReminderDefaults = { subject: string; bodyHtml: string };

export type ReminderDeliveryView = {
  dispatcher: "cron" | "poller";
  lastCronAt: string | null;
  cronStale: boolean;
  overdueCount: number;
  warning: boolean;
  /** Absolute /api/cron URL for the pinger setup. */
  cronUrl: string;
  /** The business clock in ms when the view was built (for "Last run" labels). */
  nowMs: number;
};

export type EventTypeRemindersView = {
  eventTypeId: string;
  eventTypeName: string;
  canEdit: boolean;
  /** Why the rows are read only (null when editable). */
  readOnlyReason: string | null;
  invitee: ReminderRowView;
  host: ReminderRowView;
  defaults: Record<ReminderKind, ReminderDefaults>;
  /** The default for "Include cancel and reschedule links" (the event type's setting). */
  defaultIncludeLinks: boolean;
  delivery: ReminderDeliveryView;
  /** "+ Variables" chips (NT-07) for subjects and bodies. */
  variables: { key: string; label: string }[];
};
