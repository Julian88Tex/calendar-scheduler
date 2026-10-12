// OWNER: conferencing.
//
// Conferencing public API (ARCHITECTURE section 11; SPEC VID-07, VID-10..VID-14, VID-16; docs/SCOPE.md keeps Google
// Meet, created through the organizer's Google Calendar event, plus the stable /events/{id}/join link). Conference
// links are generated at provisioning time (lifecycle-core jobs), never at event type creation (VID-12).
//
// Provisioning recipe for lifecycle-core (Google Meet):
//   const organizer = resolveConferenceOrganizer({ organizerUserId, hosts, preferredOrganizerUserId });
//   let location = await createConference({ kind, organizerUserId: organizer, scheduledEventId, ..., location: meeting.location });
//   // status "processing": write the calendar event and ask for the conference
//   const res = await upsertLinkedEvent({ ..., event: { ..., conference: calendarConferenceFor(location.kind) } });
//   location = applyLinkedEventConference(location, res);   // pushed | initiated (Meet pending) | processing | failed
//   // initiated: retry later with refreshMeetingConference(scheduledEventId); failed: email the host (VID-12)
//   // with conferenceErrorMessage(location.error, location.kind) and show "Web conferencing details to follow."
// Reschedules keep the conference (updateConference; Meet moves with its calendar event) unless
// conferenceNeedsRecreate says the organizer changed; cancels delete the calendar event, which removes the Meet.
//
// Client components import the pure helpers from "@/lib/conferencing/kinds" (this index is server only).
import "server-only";

export {
  CONFERENCE_KINDS,
  CONFERENCING_COPY,
  calendarConferenceFor,
  conferenceErrorMessage,
  conferenceJoinUrl,
  conferenceLocationText,
  conferenceMode,
  conferenceProviderName,
  isConferenceKind,
  isConferencePending,
  isSafeJoinUrl,
  type ConferenceErrorCode,
  type ConferenceKind,
  type ConferenceMode,
} from "./kinds";
export {
  CALENDAR_SETTINGS_PAGE_PATH,
  GOOGLE_MEET_PAGE_PATH,
  getConferencingOptions,
  getGoogleMeetStatus,
  googleMeetConnectHref,
  listMeetEventTypes,
  type ConferencingOption,
  type ConferencingUnavailableCode,
  type GoogleMeetState,
  type GoogleMeetStatus,
  type MeetEventType,
} from "./options";
export {
  conferenceNeedsRecreate,
  createConference,
  deleteConference,
  resetConference,
  resolveConferenceOrganizer,
  updateConference,
  type CreateConferenceInput,
} from "./service";
export { applyCalendarConference, applyLinkedEventConference, refreshMeetingConference, type CalendarConferenceResult } from "./native";
export { decideJoin, loadJoinMeeting, type JoinOutcome } from "./join";
