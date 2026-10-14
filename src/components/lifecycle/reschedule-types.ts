// Serializable props of the invitee reschedule flow (server/reschedule-page.ts builds them; reschedule-flow.tsx renders
// them). Types only: client and server safe.
import type { FormValues } from "@/components/booking/lib/form";
import type { HostHeader } from "@/components/booking/lib/hosts";
import type { BrandHeaderView, EventView } from "@/components/booking/types";

export type RescheduleFlowProps = {
  /** The active invitee (the capability of this page). */
  inviteeId: string;
  /** "/reschedulings/{inviteeId}" (the calendar step; the details step adds "/{ISO start}"). */
  basePath: string;
  /** The invitee's cancel page while canceling still works. */
  cancelPath: string | null;
  /** CR-08: picking a time books again (the old meeting was canceled by "Share new times to meet"). */
  rebook: boolean;
  /** The invitee whose meeting the slots ignore (SCH-24); null for a rebook. */
  rescheduleTarget: string | null;
  /** Slots endpoint target (the event type id). */
  slotsTarget: string;
  /** The event type with its current settings (BK-03 view). */
  event: EventView;
  host: HostHeader;
  hostName: string;
  brandHeader: BrandHeaderView;
  ribbon: boolean;
  /** The meeting being moved (ISO UTC), shown struck through as "Former Time". */
  former: { start: string; end: string };
  /** BK-07: the original duration when still offered, else the default. */
  originalDuration: number;
  initial: {
    mode: "calendar" | "details";
    month: string | null;
    date: string | null;
    /** Details step start (ISO UTC). */
    start: string | null;
    /** Deep link check (BK-08): false when the start of a details URL is not bookable. */
    startAvailable: boolean | null;
    duration: number;
  };
  /** The details form prefilled from the stored invitee (CR-03). */
  values: FormValues;
  /** The invitee's stored zone and time format (used until the browser's are known). */
  inviteeZone: string | null;
  inviteeTimeFormat: "12h" | "24h" | null;
  serverNow: number;
  hostZone: string;
  weekStart: 0 | 1;
  operatorEmail: string | null;
  privacyUrl: string | null;
  termsUrl: string | null;
  appName: string;
  collectMarketing: boolean;
  /** Name of the "Remember this device" cookie (a rebook with email verification, BK-17). */
  trustedDeviceCookie: string;
};
