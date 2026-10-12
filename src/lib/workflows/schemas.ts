// Input schemas of the event type reminders actions (SPEC NT-09, NT-11, NT-24; ARCHITECTURE section 26 rule 4).
// Client safe (the dialog validates with the same rules before saving).
import { z } from "zod";
import { MAX_REMINDER_TIMINGS, OFFSET_UNITS, TIMING_MESSAGES, validateTimings } from "./timing";

export const REMINDER_KINDS = ["invitee", "host"] as const;

/** Email subject limit (our choice). */
export const SUBJECT_MAX = 300;
/** NT-24: invitee email bodies up to 20,000 characters (plain text length). */
export const BODY_TEXT_MAX = 20_000;
/** Raw HTML limit before sanitizing (markup around 20,000 characters of text). */
export const BODY_HTML_MAX = 100_000;

export const REMINDER_MESSAGES = {
  subjectRequired: "Enter an email subject.",
  subjectTooLong: `Subjects can be up to ${SUBJECT_MAX} characters.`,
  bodyRequired: "Enter an email message.",
  bodyTooLong: "Email messages can be up to 20,000 characters.",
  limit: "You can have up to 50 workflows.",
  notAvailable: "Reminders aren't available for this event type.",
} as const;

export const ReminderTimingSchema = z.object({
  amount: z.coerce.number({ error: TIMING_MESSAGES.amount }).int(TIMING_MESSAGES.amount).min(1, TIMING_MESSAGES.amount),
  unit: z.enum(OFFSET_UNITS),
});

export const SaveRemindersSchema = z
  .object({
    eventTypeId: z.uuid(),
    kind: z.enum(REMINDER_KINDS),
    enabled: z.boolean(),
    timings: z.array(ReminderTimingSchema).min(1, TIMING_MESSAGES.none).max(MAX_REMINDER_TIMINGS, TIMING_MESSAGES.tooMany),
    /** null keeps the default subject. */
    subject: z.string().max(SUBJECT_MAX, REMINDER_MESSAGES.subjectTooLong).nullable(),
    /** null keeps the default message. */
    bodyHtml: z.string().max(BODY_HTML_MAX, REMINDER_MESSAGES.bodyTooLong).nullable(),
    includeCancelRescheduleLinks: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const errors = validateTimings(v.timings);
    for (const [key, message] of Object.entries(errors)) {
      ctx.addIssue({ code: "custom", message, path: key === "list" ? ["timings"] : ["timings", Number(key), "amount"] });
    }
  });
export type SaveRemindersInput = z.infer<typeof SaveRemindersSchema>;

export const ToggleRemindersSchema = z.object({ eventTypeId: z.uuid(), kind: z.enum(REMINDER_KINDS), enabled: z.boolean() });
export type ToggleRemindersInput = z.infer<typeof ToggleRemindersSchema>;

export const LoadRemindersSchema = z.object({ eventTypeId: z.uuid() });
