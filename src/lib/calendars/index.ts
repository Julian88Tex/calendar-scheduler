// OWNER: calendar-integrations.
//
// Calendar integrations public API (ARCHITECTURE section 10.2; docs/SCOPE.md: Google Calendar only). Callers pass user
// ids they already authorized (section 18.7); these functions never decide access themselves.
// - getExternalBusy / listExternalEvents: the busy cache (busy.ts): per window caching with CAL-10 freshness,
//   single-flight fetching, stale fallback, NOCAL, own events excluded (CAL-18).
// - getDestinationCalendar: the event type override or the user's destination calendar (connections.ts).
// - upsertLinkedEvent / deleteLinkedEvent / repointLinkedEvents: provider events this app writes (linked-events.ts).
// - linkCalendarFromOAuth: CAL-17 sign-in connection (connections.ts).
// - getCalendarHealth: CAL-15 banner data (health.ts).
// - replaceImportedBusy: CAL-22 cache-only import connection (connections.ts).
// Additive exports: refreshLinkedConference (re-read a pending Meet link, VID-07).
import "server-only";

export type { CalendarProviderId, WriteEventInput, WriteEventResult } from "./providers/types";
export { getExternalBusy, listExternalEvents, type ExternalBusy, type ExternalBusyByUser, type ExternalEventListItem } from "./busy";
export { getDestinationCalendar, linkCalendarFromOAuth, replaceImportedBusy, type DestinationCalendar } from "./connections";
export {
  deleteLinkedEvent,
  refreshLinkedConference,
  repointLinkedEvents,
  upsertLinkedEvent,
  type LinkedEventInput,
  type UpsertLinkedEventResult,
} from "./linked-events";
export { getCalendarHealth } from "./health";
