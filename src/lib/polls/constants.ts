// Meeting poll limits, job types and shared user-facing copy (SPEC MP-04, MP-06, MP-14, MP-24, MP-30; research
// meeting-polls.md B16 and B18). Pure and client safe: polls-ui imports the limits and the copy from here.

/** B16 limits. */
export const MAX_POLL_OPTIONS = 100;
export const MAX_POLL_PARTICIPANTS = 1_000;
export const MAX_POLL_COMMENTS = 200;
export const MAX_POLL_COHOSTS = 10;
export const MAX_TITLE_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 8_000;
export const MAX_NAME_LENGTH = 100;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_COMMENT_LENGTH = 2_000;
export const MAX_INVITE_MESSAGE_LENGTH = 2_000;
export const MAX_INVITE_SUBJECT_LENGTH = 200;
export const MAX_BOOKING_MESSAGE_LENGTH = 2_000;
export const MAX_VOTES_PER_OPTION_LIMIT = 1_000;
/** Recipients of one "Invite people" send, and invite emails per host per day (MP-06). */
export const MAX_INVITES_PER_SEND = 200;
export const MAX_INVITE_EMAILS_PER_DAY = 200;
/** Option durations: 5 minutes to 24 hours; all-day options are date-only (MP-02). */
export const MIN_OPTION_MINUTES = 5;
export const MAX_OPTION_MINUTES = 24 * 60;
/** Options start within the next 365 days. */
export const OPTION_HORIZON_DAYS = 365;
/** Custom reminders: up to 3; at most 3 automatic reminders per participant (MP-24). */
export const MAX_CUSTOM_REMINDERS = 3;
export const MAX_AUTOMATIC_REMINDERS = 3;
/** "Send reminder now" is throttled to once per participant per 12 hours (MP-16). */
export const MANUAL_REMINDER_THROTTLE_MS = 12 * 60 * 60 * 1000;
/** Slug edits keep the old link redirecting for 90 days (MP-05). */
export const SLUG_REDIRECT_DAYS = 90;
/** Canceled (deleted) polls are purged after 30 days (MP-22). */
export const PURGE_AFTER_DAYS = 30;
/** "Voting closes in {relative time}" banner within 24 hours of the deadline (MP-15). */
export const DEADLINE_SOON_MS = 24 * 60 * 60 * 1000;
/** Deadline approaching host email, 24 hours before the deadline (MP-23). */
export const DEADLINE_WARNING_MS = 24 * 60 * 60 * 1000;
/** Subscribed voters get at most one "others voted" email per 10 minutes (MP-23). */
export const SUBSCRIBER_BATCH_MS = 10 * 60 * 1000;
/** Edit cookie lifetime (MP-11). */
export const EDIT_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
/** Voter calendar check result cookie lifetime (MP-13: kept in the browser only). */
export const FREEBUSY_COOKIE_MAX_AGE_SECONDS = 30 * 60;
/** Verification codes (MP-04 "Verify email"): 6 digits, 10 minutes, 5 attempts, 5 codes per email per hour. */
export const VERIFICATION_TTL_MS = 10 * 60 * 1000;
export const VERIFICATION_MAX_ATTEMPTS = 5;
export const VERIFICATION_CODES_PER_HOUR = 5;
/** Rate limits (MP-30). */
export const VOTE_SUBMITS_PER_IP_PER_HOUR = 10;
export const COMMENTS_PER_IP_PER_HOUR = 20;
/** Meeting reminders of a booked poll (MP-18 "Send meeting reminders": 24 hours and 1 hour before). */
export const MEETING_REMINDER_OFFSETS_MINUTES = [24 * 60, 60] as const;
/** Default event type color of polls (B13: purple left border). */
export const POLL_COLOR = "#8247f5";
/** Options offered in the Duration select (MP-02). */
export const DURATION_CHOICES = [15, 30, 45, 60, 90, 120] as const;

/**
 * The cookies holding the voter's edit token: EDIT_COOKIE on /p/{slug} (the voter page and its Server Actions) and
 * EDIT_API_COOKIE on /api/public/polls/{slug} (the public routes). Two names because a response built with next/headers
 * cookies() keeps one cookie per name. Inside embeds the page mirrors the token in localStorage under EDIT_COOKIE.
 */
export const EDIT_COOKIE = "kairos_poll_edit";
export const EDIT_API_COOKIE = "kairos_poll_edit_api";
/** The cookie holding the voter's last calendar check (MP-13) on /p/{slug}, never a provider token. */
export const FREEBUSY_COOKIE = "kairos_poll_freebusy";

/** Link endings (MP-04). */
export const POLL_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/;

/** Job types of this module (ARCHITECTURE 12.2). */
export const POLL_JOBS = {
  deadline: "polls.deadline",
  deadlineWarning: "polls.deadline_warning",
  expire: "polls.expire",
  reminder: "polls.reminder",
  digest: "polls.digest",
  holdsSync: "polls.holds_sync",
  notify: "polls.notify",
  notifySubscribers: "polls.notify_subscribers",
  email: "polls.email",
  purge: "polls.purge",
  sweep: "polls.sweep",
  autoBook: "polls.auto_book",
  rebookInvitees: "polls.rebook_invitees",
  meetingReminder: "polls.meeting_reminder",
} as const;

/** The jobs group of one poll (cancelJobs({ groupKey, type })). */
export const pollJobGroup = (pollId: string) => `poll:${pollId}`;

/** User-facing copy shared by services and pages (B18; [C] Calendly verbatim, others ours). */
export const POLL_COPY = {
  label: "Meeting poll",
  selectTimes: "Select all the times you're available to meet",
  preferencesSubtext: "The meeting host will see your preferences when deciding on a final time.",
  singleSpotWarning: " Reminder: Voting for multiple times helps the poll host find the best meeting time for everyone.",
  shareTimesHeading: "Share your preferred times",
  shareTimes: "Share times",
  thanks: "Thanks for voting!",
  thanksDescription: "You'll receive a calendar invitation when the host decides a final time from submitted votes.",
  editTimes: "Edit your preferred times",
  decline: "None of these work for me",
  full: "Full",
  past: "Past",
  closed: "Voting for this poll has closed.",
  closedHint: "The host will share the final time soon.",
  booked: "This meeting has been scheduled.",
  canceled: "This poll is no longer available.",
  expired: "This poll has ended.",
  hostOnlyComments: "Only the host can see comments",
  previewBanner: "Preview, your votes will not be saved",
  hiddenInvitees: "Invitees won't see each other in the invite.",
  removedByHostReason: "Removed by the host",
} as const;

/** Error and validation messages (GEN-11: no em or en dashes). */
export const POLL_ERRORS = {
  notFound: "This poll is no longer available.",
  forbidden: "You don't have access to this poll.",
  ownerOnly: "Only the poll's creator can do that.",
  votingClosed: "Voting for this poll has closed.",
  pollBooked: "This meeting has already been scheduled.",
  pollEnded: "This poll has ended.",
  invalidTransition: "This poll can't be changed that way right now.",
  optionNotFound: "That time is no longer part of this poll.",
  optionPast: "That time has already passed.",
  optionFull: "This time is full.",
  maxChoices: "You can choose up to {n} times.",
  ifNeedBeOff: "This poll only accepts Yes or No.",
  duplicateEmail: "You've already voted with this email. We've sent you a link to update your response.",
  emailRequired: "Enter your email.",
  emailInvalid: "Enter a valid email address.",
  nameRequired: "Enter your name.",
  verificationRequired: "Enter the 6-digit code we sent to your email.",
  verificationInvalid: "That code isn't right. Check your email and try again.",
  verificationExpired: "That code has expired. Request a new one.",
  verificationTooMany: "Too many attempts. Request a new code.",
  tooManyParticipants: "This poll has reached its participant limit.",
  tooManyOptions: `A poll can have up to ${MAX_POLL_OPTIONS} times.`,
  noOptions: "Add at least one time.",
  lastOption: "A poll needs at least one time.",
  optionInPast: "Choose a time in the future.",
  optionTooFar: `Times must be within the next ${OPTION_HORIZON_DAYS} days.`,
  optionDuration: "Durations must be between 5 minutes and 24 hours.",
  optionsLocked: "Reopen the poll to change its times.",
  pastOptionFrozen: "Times that have passed can't be changed.",
  confirmRemove: "Some people voted for these times. Confirm to remove them and their votes.",
  deadlinePast: "Choose a deadline in the future.",
  deadlineAfterLast: "The deadline can't be after the last proposed time.",
  deadlineMoveFirst: "Move or clear the deadline before reopening voting.",
  maxVotesTooLow: "The limit can't be lower than the votes a time already has ({n}).",
  ifNeedBeInUse: "Some people already answered If need be.",
  slugInvalid: "Use 3 to 64 lowercase letters, numbers or hyphens.",
  slugTaken: "This link is already taken.",
  tooManyCohosts: `A poll can have up to ${MAX_POLL_COHOSTS} co-hosts.`,
  cohostRemoveOwnerOnly: "Only the poll's creator can remove co-hosts.",
  locationNotAllowed: "Choose a location everyone can use (not one the invitee provides).",
  bookedLocationLocked: "The location of a scheduled meeting can't be changed here.",
  appConflict: "You already have '{event}' at this time.",
  appConflictUntitled: "A host already has a meeting at this time.",
  noInvitees: "Choose at least one invitee.",
  inviteeNoEmail: "No email, can't send an invite.",
  tooManyRecipients: `You can invite up to ${MAX_INVITES_PER_SEND} people at once.`,
  inviteDailyLimit: "You've sent the maximum number of invitations for today. Try again tomorrow.",
  noRecipients: "Add at least one email address.",
  commentsOff: "Comments are turned off for this poll.",
  tooManyComments: "This poll has reached its comment limit.",
  commentEmpty: "Write a comment first.",
  reminderThrottled: "A reminder was sent recently. Try again later.",
  formExpired: "This page has expired. Refresh and try again.",
  moveTooLong: "Meetings longer than 12 hours can't be moved. Cancel the meeting and book the new time.",
  rebookReopen: "Reopen the poll to choose a different time.",
  unsubscribeInvalid: "This unsubscribe link is invalid or has expired.",
  editLinkInvalid: "This link is invalid or has expired.",
  icsInvalid: "We couldn't read that calendar link. Check it and try again.",
} as const;
