// Serializable shapes of the event type editor and services (SPEC ET-14 to ET-26). Client and server safe.
import type { ConfirmationLink, LocationConfig, NotificationTemplates } from "@/db/types";
import type { ScheduleContent } from "@/lib/availability/intervals";
import type { UiKind } from "./constants";
import type { EventPersonas, Persona } from "@/components/booking/lib/personas";

export type QuestionType = "string" | "text" | "single_select" | "multi_select" | "dropdown" | "phone_number";

/** One custom question of the invitee form (ET-24). New questions carry a client generated id until saved. */
export type QuestionDraft = {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  enabled: boolean;
  answerChoices: string[];
  includeOther: boolean;
};

/** The event type's availability choice (ET-19, AV-11): a named schedule of the owner or event-only hours. */
export type ScheduleChoiceDraft = { kind: "schedule"; scheduleId: string | null } | { kind: "custom"; content: ScheduleContent };

export type DateRangeDraft = {
  type: "rolling" | "fixed" | "unlimited";
  days: number;
  mode: "calendar_days" | "weekdays" | "available_days";
  start: string | null;
  end: string | null;
};

/**
 * The whole editable state of an event type, saved atomically by "Save changes" (ET-14). `durations` lists every
 * duration the invitee may choose, the default first (ET-16). `slug` is "" for a new type whose link follows the name.
 */
export type EventTypeDraft = {
  name: string;
  color: string;
  slug: string;
  descriptionHtml: string;
  durations: number[];
  locations: LocationConfig[];
  schedule: ScheduleChoiceDraft;
  dateRange: DateRangeDraft;
  minimumNoticeMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  slotIncrementMinutes: number;
  limitPerDay: number | null;
  limitPerWeek: number | null;
  limitPerMonth: number | null;
  timeZoneDisplay: "auto" | "locked";
  lockedTimeZone: string | null;
  destinationCalendarId: string | null;
  nameFormat: "full" | "first_last";
  allowGuests: boolean;
  questions: QuestionDraft[];
  notificationType: "auto" | "calendar_invitation" | "email_confirmation";
  notificationTemplates: NotificationTemplates;
  includeCancelRescheduleLinks: boolean;
  includeAnswersInNotifications: boolean;
  cancellationPolicy: string;
  afterBooking: "confirmation_page" | "redirect";
  redirectUrl: string;
  redirectPassDetails: boolean;
  scheduleAnotherEnabled: boolean;
  scheduleAnotherLabel: string;
  confirmationLinks: ConfirmationLink[];
  secret: boolean;
  internalNote: string;
  /**
   * The personas the type is shown to and its wording for each (event_types.metadata.personas, lib/personas.ts in the
   * booking components); null for team types, and for new types made outside the editor (shown like never-saved ones).
   */
  personas: EventPersonas | null;
};

export type EditorScheduleOption = { id: string; name: string; isDefault: boolean; content: ScheduleContent };

export type EditorCalendarOption = { id: string; name: string; accountEmail: string | null };

/** ConferencingOption of @/lib/conferencing, repeated here so client code needs no server import. */
export type EditorConferencingOption = { available: boolean; reason?: string; connectUrl?: string };

/** Everything the editor page needs (getEventTypeEditorData / getNewEventTypeEditorData). */
export type EventTypeEditorData = {
  mode: "create" | "edit";
  eventTypeId: string | null;
  /** draftVersion of the loaded event type, sent back on save to detect concurrent edits of the editor's settings. */
  version: string | null;
  kind: UiKind;
  kindLabel: string;
  access: "owner" | "edit" | "view";
  canDelete: boolean;
  active: boolean;
  draft: EventTypeDraft;
  owner: {
    id: string;
    name: string;
    handle: string | null;
    timezone: string;
    timeFormat: "12h" | "24h";
    weekStart: 0 | 1;
    locale: string;
  };
  /** "kairos.example.com/julian/" (the Event link prefix, ET-23). */
  linkPrefix: string | null;
  /** Absolute public URL of the saved event type (null for new types or owners without a handle). */
  publicUrl: string | null;
  /** Same-origin preview path for the iframe (ARCHITECTURE 17.1), null when the owner has no handle. */
  previewPath: string | null;
  schedules: EditorScheduleOption[];
  /** False for team event types (each host's schedule applies, ET-19). */
  scheduleEditable: boolean;
  conferencing: Record<string, EditorConferencingOption>;
  calendars: EditorCalendarOption[];
  /** The user's destination calendar name (the "Default ({calendar})" option, CAL-20). */
  defaultCalendarName: string | null;
  /** CAL-12: calendar invitations need a Google or Microsoft destination calendar. */
  invitationsAvailable: boolean;
  /** Host-level meeting limits across all event types (Availability > Advanced, SCH-09). */
  hostLimits: { day: number | null; week: number | null; month: number | null };
  /** Today in the owner's zone (date pickers). */
  today: string;
  /** The owner's personas (Settings > Personas) for the Personas section; null for team types. */
  personas: Persona[] | null;
};

/** A row of the Scheduling page list (event-types-list renders it). */
export type EventTypeListItem = {
  id: string;
  name: string;
  slug: string;
  color: string;
  kind: UiKind;
  kindLabel: string;
  active: boolean;
  secret: boolean;
  position: number;
  durations: number[];
  locationKinds: LocationConfig["kind"][];
  locationSummary: string;
  internalNote: string | null;
  scheduleId: string | null;
  customSchedule: boolean;
  /** "Weekdays, 9 am - 5 pm" or "Hours vary". */
  availabilitySummary: string;
  publicPath: string | null;
  publicUrl: string | null;
  /** The personas this event type is shown to (Event types > Personas), by id. */
  personaIds?: string[];
  access: "owner" | "edit" | "view";
  updatedAt: string;
};

/** The save action's success payload. */
export type SaveEventTypeResult = {
  id: string;
  slug: string;
  version: string;
  created: boolean;
  /** The saved state as the editor shows it (server ids for new questions, normalized values). */
  draft: EventTypeDraft;
};
