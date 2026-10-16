"use server";
// Server Actions of the event type reminders section (SPEC NT-09, ET-25; ARCHITECTURE section 26 rule 3): parse,
// authorize through the service (event type access, cross-tenant check in the transaction), then run the backfill
// job right after the response so meetings that are already booked get their reminders within seconds.
import { runAction } from "@/lib/actions";
import { runJobsAfterResponse } from "@/lib/jobs";
import { getEventTypeReminders, saveEventTypeReminders, setEventTypeRemindersEnabled } from "./reminders";
import { LoadRemindersSchema, SaveRemindersSchema, ToggleRemindersSchema } from "./schemas";
import { BACKFILL_JOB } from "./store";

/** The reminders section data of an event type. */
export async function loadEventTypeRemindersAction(raw: unknown) {
  return runAction(LoadRemindersSchema, raw, async (input, { actor, db }) => getEventTypeReminders(actor, input.eventTypeId, db));
}

/** Saves the "Email reminders" or "Email reminders to host" dialog. */
export async function saveEventTypeRemindersAction(raw: unknown) {
  return runAction(SaveRemindersSchema, raw, async (input, { actor, db }) => {
    const result = await saveEventTypeReminders(actor, input, db);
    if (result.backfillJobs) runJobsAfterResponse({ types: [BACKFILL_JOB] });
    return result.view;
  });
}

/** The On/Off toggle of a reminder row. */
export async function setEventTypeRemindersEnabledAction(raw: unknown) {
  return runAction(ToggleRemindersSchema, raw, async (input, { actor, db }) => {
    const result = await setEventTypeRemindersEnabled(actor, input, db);
    if (result.backfillJobs) runJobsAfterResponse({ types: [BACKFILL_JOB] });
    return result.view;
  });
}
