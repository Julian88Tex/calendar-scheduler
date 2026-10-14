// Meeting poll types (SPEC MP-*; research meeting-polls.md Parts B to D). Type-only (plus no runtime code), safe to
// import from client components: polls-ui renders these shapes (the voter page, results, list, book dialog).
// Every instant is an ISO 8601 UTC string; date-only options carry allDayDate "YYYY-MM-DD" instead of start/end.
import type { LocationConfig, LocationKind } from "@/db/types";

export type PollStatus = "open" | "closed" | "booked" | "canceled" | "expired";
export type PollVisibility = "host_only" | "counts_only" | "after_vote" | "everyone";
export type VoteChoice = "yes" | "if_need_be" | "no";
export type ParticipantStatus = "invited" | "responded" | "declined";
export type ParticipantSource = "link" | "invite" | "host_added";
export type NotifyMode = "instant" | "daily_digest" | "off";
export type ReminderMode = "off" | "smart" | "custom";
export type TimeZoneMode = "auto" | "fixed";
export type ReminderOffset = { kind: "after_invite" | "before_deadline"; minutes: number };
export type PollAccessLevel = "owner" | "manage";

/** A proposed time as stored (B1 "Option"). */
export type PollOptionView = {
  id: string;
  start: string | null;
  end: string | null;
  allDayDate: string | null;
  durationMinutes: number;
  position: number;
  createdAt: string;
  /** The option has started (votes on it are frozen, it can't be booked). */
  isPast: boolean;
};

/** The option list of a new poll or of "Add times": a timed option, or a date-only (all-day) option. */
export type PollOptionInput = { start: string; end: string } | { date: string };

export type PollHostView = { userId: string; name: string; avatarUrl: string | null; role: "owner" | "cohost" };

/** The location line shown before booking (MP-07): the conferencing promise, an address, a phone number or text. */
export type PollLocationView = {
  kind: LocationKind;
  /** "Web conferencing details provided upon confirmation." for conferencing kinds. */
  text: string;
  additionalInfo: string | null;
  isConference: boolean;
  provider: string | null;
} | null;

// ---------------------------------------------------------------------------------------------------------------
// Voter page (public JSON, MP-07 to MP-15). Redacted per results visibility on the server (MP-12): other
// participants' emails never appear; names and votes only in "everyone" (and "after_vote" once the viewer submitted).

export type VoterOptionView = PollOptionView & {
  /** Capacity reached for new selections (shown in every visibility mode, MP-12). */
  isFull: boolean;
  /** Counts of other participants and the viewer (counts_only, everyone, after_vote once submitted). */
  counts: { yes: number; ifNeedBe: number } | null;
  /** Names per answer (everyone, after_vote once submitted). */
  voters: { yes: string[]; ifNeedBe: string[] } | null;
};

export type VoterParticipantView = {
  /** Opaque per-response key (not the participant id). */
  key: string;
  name: string;
  status: ParticipantStatus;
  votes: Record<string, VoteChoice>;
  isYou: boolean;
};

export type PollCommentView = {
  id: string;
  authorName: string;
  isHost: boolean;
  body: string;
  createdAt: string;
  /** host_only polls: visible to hosts and the author only. */
  hostOnly: boolean;
  /** The viewer may delete it (the author through the edit token, or a host). */
  canDelete: boolean;
};

export type VoterSelfView = {
  participantId: string;
  name: string;
  /** The viewer's own email (shown read-only), never anyone else's. */
  email: string | null;
  status: ParticipantStatus;
  submitted: boolean;
  votes: Record<string, VoteChoice>;
  /** Options added after the viewer's last submit ("?" cells). */
  unknownOptionIds: string[];
  /** The viewer chose more times than the current "Max choices per participant" (must fix on the next edit). */
  overLimit: boolean;
  subscribed: boolean;
  unsubscribed: boolean;
  emailVerified: boolean;
};

export type BookedMeetingView = {
  scheduledEventId: string;
  start: string;
  end: string;
  allDayDate: string | null;
  status: "active" | "canceled";
  location: PollLocationView;
  /** Booked location details (address, join link once it exists). */
  locationText: string | null;
  joinUrl: string | null;
  /** "Add to calendar" (MP-15): Google, Outlook.com, Office 365 and the ICS download; empty once canceled. */
  addToCalendar: { id: "google" | "outlook" | "office365" | "ical"; label: string; url: string }[];
};

export type VoterPollView = {
  poll: {
    slug: string;
    title: string;
    descriptionHtml: string | null;
    status: PollStatus;
    timezone: string;
    timeZoneMode: TimeZoneMode;
    locale: string;
    allowIfNeedBe: boolean;
    requireEmail: boolean;
    verifyEmail: boolean;
    allowComments: boolean;
    maxChoicesPerParticipant: number | null;
    deadline: string | null;
    /** Within 24 hours of the deadline (banner "Voting closes in {relative time}"). */
    deadlineSoon: boolean;
    /** Single duration in minutes, or null when durations differ ("Varies"). */
    durationMinutes: number | null;
    location: PollLocationView;
    hosts: PollHostView[];
    resultsVisibility: PollVisibility;
    /** "Get updates when others vote" is offered (visibility shows others). */
    canSubscribe: boolean;
    /** Comments are visible only to hosts and their author ("Only the host can see comments"). */
    commentsHostOnly: boolean;
  };
  options: VoterOptionView[];
  /** The viewer's response (edit cookie, invite link or signed-in user), or null. */
  me: VoterSelfView | null;
  /** Invite link or signed-in user: name and email to prefill read-only. */
  prefill: { name: string; email: string; locked: boolean } | null;
  /** Other responses (everyone, after_vote once submitted), or null. */
  participants: VoterParticipantView[] | null;
  /** Total respondents when visibility shows counts, else null. */
  respondentCount: number | null;
  comments: PollCommentView[] | null;
  canVote: boolean;
  booked: BookedMeetingView | null;
  /**
   * The signed-in viewer hosts this poll ("View live page"): the page shows "Preview, your votes will not be saved"
   * and does not submit.
   */
  viewerIsHost: boolean;
  /**
   * "Check my calendar" (MP-13): the Google start link (OAuth intent poll_freebusy, back to /p/{slug}?calendar=checked)
   * when Google sign-in is configured, else null (the ICS link check is always offered; signed-in app users can use
   * their own connected calendars).
   */
  calendarCheck: { googleStartPath: string | null; account: boolean };
};

// ---------------------------------------------------------------------------------------------------------------
// Host results (MP-16, MP-17)

export type HostCalendarStatus =
  | { state: "free" }
  /** External calendar event (amber "Conflicts with '{title}'"); title null for co-hosts (GEN-08). */
  | { state: "conflict"; title: string | null; hostName: string | null }
  /** Another poll's hold (warning). */
  | { state: "hold"; title: string | null; hostName: string | null }
  /** An app meeting (red "Booked: {event}", blocks booking). */
  | { state: "booked"; title: string | null; hostName: string | null; meetingId: string | null }
  | { state: "unknown" };

export type RankedOptionView = PollOptionView & {
  counts: { yes: number; ifNeedBe: number; no: number; noAnswer: number };
  voters: { yes: string[]; ifNeedBe: string[]; no: string[] };
  /** 1-based rank among future options (null for past options). */
  rank: number | null;
  isBest: boolean;
  requiredOk: boolean;
  hostStatus: HostCalendarStatus;
  isBooked: boolean;
  isFull: boolean;
};

export type HostParticipantView = {
  id: string;
  name: string;
  email: string | null;
  status: ParticipantStatus;
  source: ParticipantSource;
  isRequired: boolean;
  subscribed: boolean;
  unsubscribed: boolean;
  timezone: string | null;
  votes: Record<string, VoteChoice>;
  unknownOptionIds: string[];
  overLimit: boolean;
  invitedAt: string | null;
  respondedAt: string | null;
  lastSubmittedAt: string | null;
  lastRemindedAt: string | null;
  reminderCount: number;
  commentCount: number;
  createdAt: string;
};

export type PollActivityView = {
  id: string;
  type: string;
  participantName: string | null;
  actorName: string | null;
  data: Record<string, unknown>;
  createdAt: string;
};

export type PollSettingsView = {
  allowIfNeedBe: boolean;
  hideInvitees: boolean;
  requireEmail: boolean;
  verifyEmail: boolean;
  allowComments: boolean;
  maxVotesPerOption: number | null;
  maxChoicesPerParticipant: number | null;
  deadline: string | null;
  reserveTimes: boolean;
  notifyMode: NotifyMode;
  reminderMode: ReminderMode;
  reminderOffsets: ReminderOffset[];
  autoBook: boolean;
  countHostPreference: boolean;
  hostPreferences: Record<string, VoteChoice>;
  resultsVisibility: PollVisibility;
  timeZoneMode: TimeZoneMode;
  timezone: string;
  locale: string;
  sendMeetingReminders: boolean;
};

export type HostPollView = {
  poll: {
    id: string;
    slug: string;
    link: string;
    title: string;
    descriptionHtml: string | null;
    location: LocationConfig | null;
    locationView: PollLocationView;
    status: PollStatus;
    storedStatus: PollStatus;
    defaultDurationMinutes: number;
    /** Single duration, or null when durations differ ("Mixed durations"). */
    durationMinutes: number | null;
    eventTypeId: string;
    ownerUserId: string;
    createdAt: string;
    bookedAt: string | null;
    votingClosedAt: string | null;
    reopenedAt: string | null;
    firstInviteSentAt: string | null;
    hostLastViewedAt: string | null;
    settings: PollSettingsView;
  };
  access: PollAccessLevel;
  canDelete: boolean;
  canRemoveCohosts: boolean;
  hosts: (PollHostView & { email: string })[];
  options: RankedOptionView[];
  /** Future option ids in rank order (Top times). */
  ranking: string[];
  /** No respondent yet: no "Best" badge. */
  hasResponses: boolean;
  participants: HostParticipantView[];
  counts: { respondents: number; invited: number; declined: number; total: number };
  comments: PollCommentView[];
  activity: PollActivityView[];
  holds: { enabled: boolean; active: number; pending: number; failed: number; skipped: number; provider: string | null };
  booked: BookedMeetingView | null;
};

// ---------------------------------------------------------------------------------------------------------------
// Meeting polls list (MP-26)

export type PollListFilter = "open" | "booked" | "ended" | "all" | "deleted";
export type PollHostedBy = "me" | "cohosted" | "all";

export type PollListItem = {
  id: string;
  slug: string;
  link: string;
  title: string;
  color: string;
  status: PollStatus;
  durationMinutes: number | null;
  optionCount: number;
  firstOption: string | null;
  lastOption: string | null;
  respondents: number;
  invited: number;
  /** A vote or comment arrived since the host last opened the results. */
  hasNew: boolean;
  deadline: string | null;
  booked: { scheduledEventId: string; start: string; status: "active" | "canceled" } | null;
  topOption: { optionId: string; start: string | null; allDayDate: string | null; yes: number; ifNeedBe: number } | null;
  role: "owner" | "cohost" | "admin";
  canDelete: boolean;
  createdAt: string;
};

export type PollListPage = { items: PollListItem[]; nextCursor: string | null };

// ---------------------------------------------------------------------------------------------------------------
// Book dialog (MP-18)

export type BookingPreviewInvitee = {
  participantId: string;
  name: string;
  email: string | null;
  status: ParticipantStatus;
  answer: VoteChoice | null;
  section: "can_attend" | "cannot_attend" | "no_response";
  checked: boolean;
  disabledReason: string | null;
  timezone: string | null;
};

export type BookingPreview = {
  pollId: string;
  option: PollOptionView;
  title: string;
  location: PollLocationView;
  hosts: PollHostView[];
  timezone: string;
  /** Participants whose zone differs from the poll zone ("{n} participants in other zones"). */
  otherZones: number;
  blocking: { title: string | null; hostName: string | null; meetingId: string | null }[];
  warnings: { kind: "calendar" | "hold"; title: string | null; hostName: string | null }[];
  invitees: BookingPreviewInvitee[];
  hideInvitees: boolean;
  /** Rebooking a reopened poll: the meeting that moves (null for a first booking). */
  rebook: { scheduledEventId: string; start: string; end: string; sameOption: boolean } | null;
  sendMeetingReminders: boolean;
  /** Why "Book meeting" is unavailable for this time (it started, or it is longer than a meeting can be), else null. */
  unbookableReason: string | null;
};

export type BookPollResult = { scheduledEventId: string; mode: "booked" | "rebooked" | "unchanged" };

// ---------------------------------------------------------------------------------------------------------------
// Voter responses (MP-08 to MP-11)

export type SubmitVoteOutcome =
  | { ok: true; participantId: string; editToken: string; status: ParticipantStatus; created: boolean }
  | {
      ok: false;
      code: "duplicate_email" | "verification_required" | "validation" | "closed" | "full" | "max_choices" | "bot" | "preview";
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

/** Voter calendar check result per option (MP-13): busy, free, or unknown (not covered by the check). */
export type FreeBusyStatus = "busy" | "free" | "unknown";
export type VoterCalendarCheck = {
  source: "google" | "microsoft" | "ics" | "account";
  checkedAt: string;
  statuses: Record<string, FreeBusyStatus>;
};

/**
 * Result of a Server Action whose change needs a second confirmation (B14 "more public" visibility, removing times
 * that have Yes or If need be votes): done, or the warning to show before retrying with confirm set.
 */
export type ConfirmableResult<T> =
  | { done: true; result: T }
  | { done: false; confirm: { message: string; voters: string[] } };

/** The public vote Server Action result: the service outcome, with the edit token only inside embeds. */
export type SubmitVoteActionResult =
  | { ok: true; participantId: string; status: ParticipantStatus; created: boolean; editToken: string | null }
  | Extract<SubmitVoteOutcome, { ok: false }>;
