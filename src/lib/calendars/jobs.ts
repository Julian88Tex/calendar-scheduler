// OWNER: calendar-integrations.
//
// Job handlers of this module, merged by src/lib/jobs/registry.ts (ARCHITECTURE section 12.2): calendars.sync_booked_events
// (periodic, every 10 minutes, CAL-14), calendars.sync_calendar (Google push), calendars.linked_event_retry,
// calendars.connection_problem (CAL-15 email), calendars.revoke_token (CAL-16), calendars.refresh_calendar_list(s) and
// calendars.watch_connection / calendars.watch_renew (push channels). Implementations live in job-handlers.ts.
export { handlers, periodic } from "./job-handlers";
