// Shared jsonb TypeScript types (ARCHITECTURE section 5.3). Imported by the schema, services and UI.
// No imports: this file must stay importable from plain Node type stripping (scripts, seed, tests).

export type MinuteRange = { start: number; end: number }; // minutes 0..1440, start <= end
/** Index 0 = Sunday. */
export type WeeklyHours = [
  MinuteRange[],
  MinuteRange[],
  MinuteRange[],
  MinuteRange[],
  MinuteRange[],
  MinuteRange[],
  MinuteRange[],
];

export type LocationKind =
  | "physical"
  | "outbound_call"
  | "inbound_call"
  | "google_conference"
  | "microsoft_teams_conference"
  | "zoom_conference"
  | "jitsi_conference"
  | "custom"
  | "ask_invitee"
  | "webex_conference"
  | "gotomeeting_conference";

export type LocationConfig = {
  id: string; // stable uuid, referenced by invitee choices
  kind: LocationKind;
  position: number;
  location?: string | null; // physical address/venue, custom text or URL, ask_invitee prompt
  additionalInfo?: string | null;
  phoneNumber?: string | null; // inbound_call host number (E.164)
  displayBeforeBooking?: boolean; // physical/custom: show on booking page (default true for physical, per setting for custom)
  connectionId?: string | null; // zoom: which conferencing connection (default: user's)
};

export type ConferenceStatus = "processing" | "initiated" | "pushed" | "failed";
export type ResolvedLocation = {
  configId: string | null; // LocationConfig.id chosen
  kind: LocationKind | null; // null = no location
  location: string | null; // text shown (address, phone, invitee answer, custom text)
  additionalInfo: string | null;
  joinUrl: string | null;
  status: ConferenceStatus | null;
  providerMeetingId: string | null;
  password: string | null;
  dialIn: { number: string; country?: string; type?: string }[] | null;
  data: Record<string, unknown> | null;
  error: string | null;
};

export type FreeBusyException = { mode: "includes" | "exact"; text: string };
export type ConfirmationLink = { label: string; url: string };
export type NotificationTemplates = {
  hostEventTitle?: string;
  inviteeEventTitle?: string;
  invitationDescription?: string; // calendar invitation mode
  confirmationSubject?: string;
  confirmationBody?: string; // email confirmation mode
  cancellationSubject?: string;
  cancellationBody?: string;
};
export type QuestionAnswer = {
  questionId: string | null;
  question: string;
  type: string;
  position: number;
  answer: string; // multi-select joined with "\n" (Calendly parity)
  values?: string[]; // raw selections for multi_select
};
export type Tracking = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  salesforceUuid?: string;
};
export type MeetingSettingsSnapshot = {
  notificationMode: "calendar_invitation" | "email_confirmation"; // effective CAL-12 mode; a fallback rewrites it to email_confirmation permanently
  includeCancelRescheduleLinks: boolean;
  includeAnswersInNotifications: boolean;
  templates: NotificationTemplates;
  cancellationPolicy: string | null;
  locale: string;
  timeZoneDisplay: "auto" | "locked";
  lockedTimeZone: string | null;
  color: string;
  afterBooking: "confirmation_page" | "redirect";
  redirectUrl: string | null;
  redirectPassDetails: boolean;
  scheduleAnotherEnabled: boolean;
  scheduleAnotherLabel: string;
  confirmationLinks: ConfirmationLink[];
  changeCutoffMinutes: number | null;
  requireCancelReason: boolean;
};
export type RoutingCondition = { questionId: string; operator: string; values: string[]; valuesLogic: "any" | "all" };
export type RoutingConditions = { logic: "all" | "any"; conditions: RoutingCondition[] };
export type RoutingDestination =
  | { type: "event_type"; eventTypeId: string }
  | { type: "custom_message"; headline: string; body: string }
  | { type: "external_url"; url: string; passAnswers?: boolean };
export type NotificationPrefs = {
  pollVotes: "instant" | "daily_digest" | "off";
  calendarProblems: boolean;
  dailyAgenda: boolean;
  hostAdded: boolean;
  noReplyInviteeEmails: boolean; // NT-20: omit Reply-To on invitee emails
};
export type UserPreferences = {
  // users.preferences (UI prefs, all optional)
  theme?: "light" | "dark" | "system";
  sidebarCollapsed?: boolean;
  showBuffers?: boolean;
  analyticsHiddenWidgets?: string[];
  [key: string]: unknown;
};
export type BrandColors = { background?: string; text?: string; primary?: string };

/** Event type editor live preview draft (ARCHITECTURE section 17.1). */
export type EventTypePreviewDraft = {
  name: string;
  color: string;
  durationMinutes: number;
  durationOptions: number[] | null;
  locations: LocationConfig[];
  descriptionHtml: string | null;
  priceMinor: number | null;
  currency: string | null;
  kind: "solo" | "group";
  maxInvitees: number;
  showRemainingSpots: boolean;
  timeZoneDisplay: "auto" | "locked";
  lockedTimeZone: string | null;
};

/** Defaults shared by the schema and services (AU-13, section 5.4.1). */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  pollVotes: "instant",
  calendarProblems: true,
  dailyAgenda: false,
  hostAdded: true,
  noReplyInviteeEmails: false,
};
