// Serializable view models of the lifecycle pages and host dialogs (server loaders build them, client components
// render them). Types only: client and server safe.
import type { PublicBranding } from "@/components/public/public-page-shell";
import type { HostHeader } from "@/components/booking/lib/hosts";
import type { MeetingLocationView } from "@/components/booking/lib/locations";
import type { BrandHeaderView } from "@/components/booking/types";
import type { BlockedCopy, ChangeKind } from "./lib/state";

export type MeetingSummaryView = {
  eventName: string;
  color: string;
  host: HostHeader;
  brandHeader: BrandHeaderView;
  hostName: string;
  durationMinutes: number;
  /** ISO UTC. */
  start: string;
  end: string;
  /** The invitee's stored zone (the confirmation page and emails use it too). */
  zone: string;
  zoneName: string;
  hour12: boolean;
  /** "10:00am - 10:30am, Wednesday, October 14, 2026" */
  whenText: string;
  location: MeetingLocationView | null;
  inviteeName: string;
  inviteeEmail: string;
  /** Guests of this invitee who are still invited. */
  guestCount: number;
  /** The meeting or this invitee is canceled (the summary is struck through). */
  canceled: boolean;
};

export type ChangePageShell = {
  branding: PublicBranding;
  ribbon: boolean;
  privacyUrl: string | null;
  operatorEmail: string | null;
};

export type ChangePageView = {
  kind: ChangeKind;
  inviteeId: string;
  summary: MeetingSummaryView;
  shell: ChangePageShell;
  /** null: the form (cancel) or the booking flow (reschedule). */
  blocked: BlockedCopy | null;
  requireReason: boolean;
  cancellationPolicy: string | null;
  /** "Schedule another event": the event type's booking page, else the host's landing page, else null. */
  scheduleAnotherHref: string | null;
  /** CR-08: the host asked for a new time; picking one books again. */
  rebook: boolean;
};

/** One invitee of a meeting as the host dialogs show it. */
export type HostMeetingInvitee = {
  id: string;
  name: string;
  email: string;
  /** The invitee's zone ("Switch to your invitee's time zone", CR-07). */
  timezone: string | null;
  status: "active" | "canceled";
  noShow: boolean;
};

/**
 * A booked meeting as the host dialogs need it (CR-06, CR-07, CR-08, CR-11, CR-14). meetings-dashboard builds it from
 * its own queries or with loadHostMeetingSummary (server/host-meeting.ts). Serializable.
 */
export type HostMeetingSummary = {
  scheduledEventId: string;
  eventName: string;
  color: string;
  /** ISO UTC. */
  start: string;
  end: string;
  durationMinutes: number;
  status: "active" | "canceled";
  isGroup: boolean;
  /** booking, one_off, poll, ... (one-off and poll meetings are never rescheduled through a new booking). */
  source: string;
  eventTypeId: string;
  /** The event type is active, standard and not deleted ("Share new times to meet" needs its booking page). */
  eventTypeBookable: boolean;
  hostCount: number;
  /** The viewing host's zone and time format. */
  timeZone: string;
  hour12: boolean;
  invitees: HostMeetingInvitee[];
  /** Host-only notes (CR-14). */
  notesHtml: string | null;
};
