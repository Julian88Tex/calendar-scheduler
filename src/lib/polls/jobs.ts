// OWNER: polls-core.
//
// Job handlers of this module, merged by src/lib/jobs/registry.ts (ARCHITECTURE section 12.2); see job-handlers.ts.
// Types: polls.deadline (close voting at the deadline), polls.deadline_warning (host "closes in 24 hours"),
// polls.expire (every option passed), polls.reminder (automatic reminders to non-respondents), polls.digest and
// polls.sweep (periodic), polls.holds_sync (calendar holds), polls.notify (host and subscriber notifications for one
// activity row), polls.notify_subscribers (others voted batches), polls.email (one participant or host email),
// polls.purge (periodic: deleted polls after 30 days), polls.auto_book (MP-31), polls.rebook_invitees (invitees added
// after an in-place move) and polls.meeting_reminder (the Book dialog's "Send meeting reminders").
import type { JobHandlers, PeriodicJob } from "@/lib/jobs/types";
import { pollJobHandlers, pollPeriodicJobs } from "./job-handlers";

export const handlers: JobHandlers = pollJobHandlers;
export const periodic: PeriodicJob[] = pollPeriodicJobs;
