// View models of the Meetings page (SPEC MT-01 to MT-15). The server loader (queries.ts) builds them; the client
// components render them. Types only: client and server safe, serializable.
import type { HostMeetingSummary } from "@/components/lifecycle/types";
import type { MeetingsQuery, MeetingsTab } from "./filters";

export type LocationIcon = "video" | "pin" | "phone" | "custom";

/** The LOCATION block of a meeting (MT-06): main text, second line, links and the host-facing problem. */
export type MeetingLocationView = {
  icon: LocationIcon;
  text: string;
  /** Second line (street address, the join link, who calls whom). */
  detail: string | null;
  /** Link of the main text (a custom location URL, tel:). */
  href: string | null;
  /** "Join now" target: the stable /events/{id}/join page, while the meeting can still be joined. */
  joinHref: string | null;
  /** Why there is no conference link (shown to hosts only, with "Retry" when it can be retried). */
  problem: string | null;
};

/** One invitee as the details panel shows them (EMAIL, INVITEE TIME ZONE, QUESTIONS, GUESTS, TRACKING). */
export type MeetingPersonView = {
  id: string;
  name: string;
  email: string;
  status: "active" | "canceled";
  noShow: boolean;
  /** Friendly name of the invitee's zone ("Eastern Time - US & Canada"). */
  timeZoneLabel: string | null;
  questions: { question: string; answer: string }[];
  /** Guests still invited. */
  guests: string[];
  tracking: { label: string; value: string }[];
};

/** A status line of the details panel: cancellation, reschedule, calendar or conferencing problems. */
export type MeetingNotice = {
  kind: "canceled" | "rescheduled_to" | "rescheduled_from" | "reschedule_requested" | "calendar_failed" | "calendar_fallback";
  tone: "neutral" | "info" | "warning" | "danger";
  text: string;
  /** Further lines ("Rescheduled by ...", "Reason: ..."). */
  details: string[];
  /** Link to the other meeting of a reschedule. */
  link: { label: string; eventId: string } | null;
};

export type MeetingHostView = { id: string; name: string; avatarUrl: string | null };

export type MeetingView = {
  id: string;
  eventName: string;
  color: string;
  /** ISO UTC. */
  start: string;
  end: string;
  /** "YYYY-MM-DD" of the start in the viewer's zone (the date group). */
  dateKey: string;
  /** "10:00am - 10:30am" in the viewer's zone and time format. */
  timeRange: string;
  /** "10:00am - 10:30am, Wednesday, October 14, 2026". */
  when: string;
  status: "active" | "canceled";
  /** Canceled because it was rescheduled to a new time (the "Rescheduled" badge). */
  rescheduled: boolean;
  isPoll: boolean;
  isGroup: boolean;
  /** The invitee's name, or "{n} invitees" for group slots. */
  title: string;
  /** "1 host | 0 non-hosts" (non-hosts are the guests). */
  hostsLabel: string;
  /** Group slots: "{n} of {limit} spots filled". */
  spotsLabel: string | null;
  /** Hosts, editors and org admins manage; event type viewers only view (MT-07). */
  access: "manage" | "view";
  /** The meeting's end has passed (business clock at render time). */
  ended: boolean;
  people: MeetingPersonView[];
  location: MeetingLocationView | null;
  /** "Retry" for a failed conference or calendar write (manage, active, not ended). */
  canRetry: boolean;
  hosts: MeetingHostView[];
  notices: MeetingNotice[];
  /** Host-only notes (null for viewers and when empty). */
  notesHtml: string | null;
  /** "Created 10/14/2026 by Maya Patel". */
  createdLabel: string;
  /** "Scheduled by Julian Joseph" when a host booked on the invitee's behalf. */
  scheduledByLabel: string | null;
  eventTypeId: string;
  /** "Edit Event Type" (editors of a standard event type). */
  editEventTypeHref: string | null;
  /** "Filter by Event Type" (the type is one of the filter options). */
  canFilterByEventType: boolean;
  /** "Schedule Invitee Again" (CR-13): the booking page prefilled with the invitee, for canceled or past meetings. */
  scheduleAgainHref: string | null;
  /** "Reschedule" and "Cancel" (MT-06: active meetings that have not ended, manage access). */
  canReschedule: boolean;
  canCancel: boolean;
  /** The lifecycle-ui dialogs' view of the meeting (manage access only). */
  summary: HostMeetingSummary | null;
};

export type MeetingDayGroup = { dateKey: string; label: string; meetings: MeetingView[] };

export type EventTypeOption = { id: string; name: string; color: string };

export type MeetingsPager = {
  page: number;
  /** Previous page: null on page 1; a `before` cursor, or null cursor for page 1. */
  prev: { before: string | null; page: number } | null;
  next: { after: string; page: number } | null;
};

export type MeetingsPageData = {
  /** The effective state (a deep link may have picked the tab, status and page). */
  query: MeetingsQuery;
  groups: MeetingDayGroup[];
  total: number;
  /** 1-based positions of the first and last meeting shown (0 when empty). */
  from: number;
  to: number;
  pager: MeetingsPager;
  /** A deep-linked meeting that the current tab and filters hide, shown above the list. */
  pinned: MeetingView | null;
  /** The ?event= meeting does not exist or is not visible to the viewer. */
  eventNotFound: boolean;
  eventTypes: EventTypeOption[];
  /** The viewer's landing page ("Share your link"), or null without a link. */
  shareUrl: string | null;
  /** Business clock at render time (ms): the client derives its clock offset from it (no-show control). */
  serverNow: number;
  /** Viewer's zone and its friendly name. */
  timeZone: string;
  timeZoneLabel: string;
  /** Today in the viewer's zone (Date Range presets) and the week start (0 Sunday, 1 Monday). */
  today: string;
  weekStart: 0 | 1;
  tab: MeetingsTab;
};
