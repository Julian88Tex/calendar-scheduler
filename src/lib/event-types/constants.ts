// Event type limits, presets, defaults and copy (SPEC ET-14 to ET-26, ET-33, VID-01 to VID-07; ARCHITECTURE 5.4.5).
// Pure data: client and server safe (the editor, the services, the list page and tests read it).
import type { LocationKind } from "@/db/types";

/** ET-15: event name length. */
export const NAME_MAX = 100;
/** ET-16: up to 4 durations in total (default included). */
export const MAX_DURATIONS = 4;
export const DURATION_MIN = 1;
export const DURATION_MAX = 720;
export const DURATION_PRESETS = [15, 30, 45, 60] as const;
/** ET-17: up to 20 location options (our choice; the owner's meal event uses 9). */
export const MAX_LOCATIONS = 20;
/** ET-17: location text and additional information, 255 characters each. */
export const LOCATION_TEXT_MAX = 255;
/** ET-18: sanitized description HTML. */
export const DESCRIPTION_MAX = 10_000;
/** ET-13: internal note. */
export const INTERNAL_NOTE_MAX = 2_000;
/** ET-24: questions, including disabled ones. */
export const MAX_QUESTIONS = 10;
export const QUESTION_LABEL_MAX = 500;
export const MAX_ANSWER_CHOICES = 50;
export const ANSWER_CHOICE_MAX = 200;
/** SCH-02: rolling window length. */
export const DATE_RANGE_DAYS_MIN = 1;
export const DATE_RANGE_DAYS_MAX = 3_650;
/** SCH-06: minimum notice up to 365 days. */
export const NOTICE_MAX_MINUTES = 365 * 24 * 60;
/** SCH-07 / ET-21: buffers. */
export const BUFFER_MAX = 720;
export const BUFFER_PRESETS = [0, 5, 10, 15, 30, 45, 60, 90, 120, 150, 180] as const;
/** SCH-10 / ET-23: start time increments. */
export const INCREMENT_MIN = 5;
export const INCREMENT_MAX = 720;
export const INCREMENT_PRESETS = [5, 10, 15, 20, 30, 45, 60] as const;
/** ET-21: meeting limits per period. */
export const LIMIT_MIN = 1;
export const LIMIT_MAX = 999;
/** CR-05: cancellation policy. */
export const CANCELLATION_POLICY_MAX = 2_000;
/** NT-08: template fields. */
export const TEMPLATE_TITLE_MAX = 255;
export const TEMPLATE_BODY_MAX = 10_000;
/** ET-26: confirmation page links. */
export const MAX_CONFIRMATION_LINKS = 5;
export const LINK_NAME_MAX = 60;
export const URL_MAX = 2_048;
/** ET-28 / GEN-10 supported invitee languages. */
export const SUPPORTED_LOCALES = ["en", "fr", "es", "de", "nl", "pt", "it", "uk"] as const;

/** ET-33 default question. */
export const DEFAULT_QUESTION_LABEL = "Please share anything that will help prepare for our meeting.";

export type UiKind = "one_on_one" | "group" | "collective" | "round_robin" | "multi_pool";

/** Eyebrow labels of the editor header and the card meta line (ET-01, ET-04). */
export const KIND_LABELS: Record<UiKind, string> = {
  one_on_one: "One-on-One",
  group: "Group",
  collective: "Collective",
  round_robin: "Round Robin",
  multi_pool: "Collective and Round Robin",
};

/** The UI kind of an event type row. */
export function uiKindOf(et: { kind: "solo" | "group"; poolingType: "collective" | "round_robin" | "multi_pool" | null }): UiKind {
  if (et.kind === "group") return "group";
  return et.poolingType ?? "one_on_one";
}

/** ET-33 default names per kind. */
export const DEFAULT_NAMES: Record<UiKind, string> = {
  one_on_one: "New Meeting",
  group: "New Group Meeting",
  collective: "New Collective Meeting",
  round_robin: "New Round Robin Meeting",
  multi_pool: "New Round Robin Meeting",
};

/**
 * The location kinds the editor configures (docs/SCOPE.md: in-person, Google Meet, ask invitee). Other kinds stay valid
 * in the data model (existing rows are listed and can be removed) but the editor offers no UI for them.
 */
export const EDITOR_LOCATION_KINDS: readonly LocationKind[] = ["physical", "google_conference", "ask_invitee"];

/** Kinds that may appear only once in an event type's options. */
export const SINGLETON_LOCATION_KINDS: readonly LocationKind[] = [
  "google_conference",
  "microsoft_teams_conference",
  "zoom_conference",
  "jitsi_conference",
  "webex_conference",
  "gotomeeting_conference",
  "ask_invitee",
  "outbound_call",
];

/** VID-07 editor copy when the organizer's destination calendar is not Google. */
export const GOOGLE_MEET_REQUIREMENT =
  "You must configure your calendar connections to push events to a Google Calendar to host Google Meet web conferences on your events.";
/** VID-01 pre-booking display of conferencing kinds (observed). */
export const CONFERENCING_DETAILS_COPY = "Web conferencing details provided upon confirmation.";

// Validation copy (spec strings where quoted, "our choice" otherwise).
export const MESSAGES = {
  nameRequired: "Enter an event name.",
  nameTooLong: `Use ${NAME_MAX} characters or fewer.`,
  invalidColor: "Enter a valid color like #8247F5",
  slugInvalid: "Use lowercase letters, numbers and hyphens (1 to 100 characters).",
  slugTaken: "This link is already used by another event type",
  durationRange: "Enter a duration between 1 min and 12 hrs.",
  durationDuplicate: "This duration is already an option",
  durationTooMany: `You can offer up to ${MAX_DURATIONS} durations.`,
  durationGroup: "Group events have a single duration.",
  locationsTooMany: `You can add up to ${MAX_LOCATIONS} locations.`,
  locationRequired: "Enter an address or venue.",
  locationTooLong: `Use ${LOCATION_TEXT_MAX} characters or fewer.`,
  locationDuplicate: "This location is already an option.",
  locationGroup: "Group events support one location.",
  dateRangeDays: `Enter a number of days from ${DATE_RANGE_DAYS_MIN} to ${DATE_RANGE_DAYS_MAX.toLocaleString("en-US")}.`,
  dateRangeStart: "Choose a start date.",
  dateRangeEnd: "Choose an end date on or after the start date.",
  notice: "Enter a notice of up to 365 days.",
  buffer: "Enter a buffer from 0 to 720 minutes.",
  increment: "Enter an increment from 5 to 720 minutes.",
  limit: `Enter a number from ${LIMIT_MIN} to ${LIMIT_MAX}.`,
  timeZone: "Choose a time zone.",
  questionsTooMany: `You can add up to ${MAX_QUESTIONS} questions`,
  questionRequired: "Enter a question.",
  questionTooLong: `Use ${QUESTION_LABEL_MAX} characters or fewer.`,
  choicesRequired: "Add at least one answer choice.",
  choicesTooMany: `Add up to ${MAX_ANSWER_CHOICES} answer choices.`,
  choiceRequired: "Enter an answer choice.",
  choiceTooLong: `Use ${ANSWER_CHOICE_MAX} characters or fewer.`,
  choiceDuplicate: "Answer choices must be unique.",
  descriptionTooLong: `Use ${DESCRIPTION_MAX.toLocaleString("en-US")} characters or fewer.`,
  internalNoteTooLong: `Use ${INTERNAL_NOTE_MAX.toLocaleString("en-US")} characters or fewer.`,
  redirectRequired: "Enter the URL to redirect invitees to.",
  url: "Enter a URL that starts with https:// or http://",
  linkName: `Enter a link name of up to ${LINK_NAME_MAX} characters.`,
  linksTooMany: `Add up to ${MAX_CONFIRMATION_LINKS} links.`,
  policyTooLong: `Use ${CANCELLATION_POLICY_MAX.toLocaleString("en-US")} characters or fewer.`,
  templateTooLong: "This text is too long.",
  scheduleInvalid: "Choose a schedule.",
} as const;

/** ET-14 save toast. */
export const SAVED_TOAST = "Changes saved";
/** ET-12 delete dialog copy. */
export const DELETE_TITLE = "Delete event type?";
export const DELETE_BODY =
  "Users will be unable to schedule further meetings with deleted event types. Meetings previously scheduled will not be affected.";
/** ET-14 unsaved changes guard copy. */
export const UNSAVED_TITLE = "You have unsaved changes";
export const UNSAVED_BODY = "If you leave this page, your changes will be lost.";
