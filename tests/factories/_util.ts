// Shared helpers for test factories (direct inserts that bypass services; ARCHITECTURE section 24.1).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { MeetingSettingsSnapshot, ResolvedLocation, WeeklyHours } from "@/db/types";
import type { eventTypes } from "@/db/schema";

let counter = 0;

/** Unique lowercase token usable in slugs, emails and codes (matches the GEN-02 slug pattern). */
export function uniq(prefix = "t"): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${randomBytes(2).toString("hex")}`;
}

export const newId = (): string => randomUUID();
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
export const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

/** Minutes from local midnight. */
export const hm = (hours: number, minutes = 0): number => hours * 60 + minutes;

/** Monday to Friday 09:00 to 17:00 (AU-13 default). Index 0 = Sunday. */
export const WEEKDAYS_9_TO_5: WeeklyHours = [
  [],
  [{ start: hm(9), end: hm(17) }],
  [{ start: hm(9), end: hm(17) }],
  [{ start: hm(9), end: hm(17) }],
  [{ start: hm(9), end: hm(17) }],
  [{ start: hm(9), end: hm(17) }],
  [],
];

export const toDate = (value: Date | string | number): Date => (value instanceof Date ? value : new Date(value));
export const addMinutes = (d: Date, minutes: number): Date => new Date(d.getTime() + minutes * 60_000);

export const EMPTY_LOCATION: ResolvedLocation = {
  configId: null,
  kind: null,
  location: null,
  additionalInfo: null,
  joinUrl: null,
  status: null,
  providerMeetingId: null,
  password: null,
  dialIn: null,
  data: null,
  error: null,
};

/** The settings snapshot a booking would store for this event type (section 5.3). */
export function snapshotFor(et: typeof eventTypes.$inferSelect): MeetingSettingsSnapshot {
  return {
    notificationMode: et.notificationType === "email_confirmation" ? "email_confirmation" : "calendar_invitation",
    includeCancelRescheduleLinks: et.includeCancelRescheduleLinks,
    includeAnswersInNotifications: et.includeAnswersInNotifications,
    templates: et.notificationTemplates,
    cancellationPolicy: et.cancellationPolicy,
    locale: et.locale,
    timeZoneDisplay: et.timeZoneDisplay,
    lockedTimeZone: et.lockedTimeZone,
    color: et.color,
    afterBooking: et.afterBooking,
    redirectUrl: et.redirectUrl,
    redirectPassDetails: et.redirectPassDetails,
    scheduleAnotherEnabled: et.scheduleAnotherEnabled,
    scheduleAnotherLabel: et.scheduleAnotherLabel,
    confirmationLinks: et.confirmationLinks,
    changeCutoffMinutes: et.changeCutoffMinutes,
    requireCancelReason: et.requireCancelReason,
  };
}

/** First element or a descriptive failure (insert ... returning always yields one row). */
export function one<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) throw new Error(`factory: ${what} insert returned no row`);
  return row;
}
