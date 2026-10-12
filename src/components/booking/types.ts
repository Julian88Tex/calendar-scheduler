// Serializable props of the public booking pages (server loaders in ./server build them; the client flow renders them).
// Client and server safe (types only).
import type { PublicBranding } from "@/components/public/public-page-shell";
import type { EmbedDisplayParams } from "@/lib/embed-events";
import type { BookingTargetBody, PublicQuestion } from "./lib/form";
import type { HostHeader } from "./lib/hosts";
import type { PublicLocation } from "./lib/locations";

export type EventView = {
  id: string | null;
  name: string;
  color: string;
  kind: "solo" | "group";
  /** Default duration first, then the other options (BK-07). */
  durations: number[];
  defaultDuration: number;
  /** Sanitized rich text (server), or plain text (preview drafts). */
  descriptionHtml: string | null;
  descriptionText: string | null;
  locations: PublicLocation[];
  questions: PublicQuestion[];
  nameFormat: "full" | "first_last";
  allowGuests: boolean;
  collectMarketingConsent: boolean;
  autofill: boolean;
  showRemainingSpots: boolean;
  /** Locked time zone (SCH-22), or null when the invitee's zone is used. */
  lockedTimeZone: string | null;
  active: boolean;
  secret: boolean;
  locale: string;
};

export type BrandHeaderView = { kind: "logo"; src: string } | { kind: "avatar"; src: string | null; name: string } | null;

export type ViewerView = {
  signedIn: boolean;
  /** The viewer hosts this event type (owner banner, troubleshoot, BK-24). */
  isHost: boolean;
  email: string | null;
  /** Edit event type link (null without edit access). */
  editUrl: string | null;
  /** BK-33: signed-in viewers who are not hosts see "Show times you're free". */
  mutual: boolean;
};

export type BookingPrefillView = {
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  location?: string;
  answers: Record<string, string | string[]>;
  guests: string[];
  tracking: Record<string, string>;
  durationMinutes?: number;
  routingFormSubmissionId?: string;
};

export type BookingPageProps = {
  mode: "calendar" | "details";
  /** "/julianjoseph/30min" or "/d/{code}/{slug}". */
  basePath: string;
  /** Landing page for the back=1 button (null for /d links). */
  landingPath: string | null;
  /** Absolute canonical URL of the booking page (Copy link). */
  canonicalUrl: string;
  /** Booking request target. */
  target: BookingTargetBody;
  /** Slots endpoint target (event type id or link code); null without a saved event type (new type preview). */
  slotsTarget: string | null;
  event: EventView;
  host: HostHeader;
  /** Name used in copy ("You are scheduled with {name}"), the host or team. */
  hostName: string;
  brandHeader: BrandHeaderView;
  branding: PublicBranding;
  ribbon: boolean;
  initial: {
    month: string | null;
    date: string | null;
    /** Details step start (ISO UTC). */
    start: string | null;
    /** Deep link check (BK-08): false when the start of a details URL is not bookable. */
    startAvailable: boolean | null;
    duration: number | null;
    back: boolean;
  };
  prefill: BookingPrefillView;
  /** Query parameters kept across steps, in order. */
  carry: [string, string][];
  embed: EmbedDisplayParams;
  formToken: string;
  honeypotName: string;
  trustedDeviceCookie: string;
  viewer: ViewerView;
  preview: boolean;
  /** Hosts only: the event type the availability module's Troubleshoot view opens on (link built with troubleshootHref). */
  troubleshootEventTypeId: string | null;
  /** Cloudflare Turnstile site key when bot protection is configured (BK-18); null otherwise. */
  turnstileSiteKey: string | null;
  /** Business clock of the server (fake time in E2E, SPEC 24.2). */
  serverNow: number;
  /** Zone used before the browser zone is known. */
  hostZone: string;
  weekStart: 0 | 1;
  operatorEmail: string | null;
  privacyUrl: string | null;
  termsUrl: string | null;
  appName: string;
  /** Path of the confirmation page for an invitee id ("/booking/{id}"). */
  confirmationBase: string;
};
