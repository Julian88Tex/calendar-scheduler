// Troubleshoot reason codes (SPEC SCH-21, Appendix B; UX walkthrough 21.1). Labels are the chips shown on unavailable
// times ("DAILY MAX", "MEETING LIMIT"); hints are the side sheet's explanation and fix.
import { appName } from "@/lib/brand";
import type { ReasonCode } from "./types";

/** Every code, in the order of SPEC Appendix B. */
export const REASON_CODES: readonly ReasonCode[] = [
  "CALENDAR",
  "NOCAL",
  "DAILY_MAX",
  "WEEKLY_MAX",
  "MONTHLY_MAX",
  "DURATION",
  "RANGE",
  "TOOSOON",
  "EVENT",
  "GROUP",
  "OVERLAP",
  "HOLIDAY",
  "MEETING_LIMIT",
  "HOST",
  "ROUNDROBIN",
  "UNFAIR",
  "BUFFER",
  "PAST",
  "RESERVED",
];

/**
 * Display priority: the first code of a sorted list is the primary chip. Window codes first (nothing else matters for
 * a past time), then schedule and event type rules, then multi-host outcomes, then busy sources.
 */
export const REASON_PRIORITY: readonly ReasonCode[] = [
  "PAST",
  "TOOSOON",
  "RANGE",
  "HOLIDAY",
  "DURATION",
  "GROUP",
  "DAILY_MAX",
  "WEEKLY_MAX",
  "MONTHLY_MAX",
  "MEETING_LIMIT",
  "HOST",
  "ROUNDROBIN",
  "UNFAIR",
  "NOCAL",
  "CALENDAR",
  "RESERVED",
  "EVENT",
  "OVERLAP",
  "BUFFER",
];

const RANK = new Map<ReasonCode, number>(REASON_PRIORITY.map((c, i) => [c, i]));

/** Unique codes sorted by display priority. */
export function sortReasons(codes: Iterable<ReasonCode>): ReasonCode[] {
  const unique = Array.from(new Set(codes));
  unique.sort((a, b) => (RANK.get(a) ?? 99) - (RANK.get(b) ?? 99));
  return unique;
}

export function isReasonCode(value: unknown): value is ReasonCode {
  return typeof value === "string" && RANK.has(value as ReasonCode);
}

const LABELS: Partial<Record<ReasonCode, string>> = {
  DAILY_MAX: "DAILY MAX",
  WEEKLY_MAX: "WEEKLY MAX",
  MONTHLY_MAX: "MONTHLY MAX",
  MEETING_LIMIT: "MEETING LIMIT",
};

/** The chip label of a code: "DAILY MAX", "MEETING LIMIT", "CALENDAR", ... */
export function reasonLabel(code: ReasonCode): string {
  return LABELS[code] ?? code;
}

/** Meaning and fix hint of a code (SPEC Appendix B; {AppName} is the configured product name). */
export function reasonHint(code: ReasonCode): { meaning: string; fix: string } {
  switch (code) {
    case "CALENDAR":
      return { meaning: 'A "Busy" calendar event is blocking the time', fix: 'Change the event to "Free" or remove it' };
    case "NOCAL":
      return { meaning: `${appName()} can't access your calendar`, fix: "Reconnect your calendar" };
    case "DAILY_MAX":
    case "WEEKLY_MAX":
    case "MONTHLY_MAX":
      return { meaning: "Event type meeting limit reached", fix: "Adjust limits under Limits and buffers" };
    case "DURATION":
      return { meaning: "Not enough time for your event", fix: "Shorten the event or extend availability" };
    case "RANGE":
      return { meaning: "Date is outside your availability window", fix: "Adjust the date range" };
    case "TOOSOON":
      return { meaning: "Too soon based on minimum notice", fix: "Adjust minimum scheduling notice" };
    case "EVENT":
      return { meaning: "Another meeting of this event type is booked", fix: "Reschedule or use Free/busy rules" };
    case "GROUP":
      return { meaning: "Group event has max attendees", fix: "Increase the max invitee number" };
    case "OVERLAP":
      return { meaning: "Another meeting is booked", fix: "Reschedule or use Free/busy rules" };
    case "HOLIDAY":
      return { meaning: "Date is marked as a holiday", fix: "Edit holidays" };
    case "MEETING_LIMIT":
      return { meaning: "Host-level meeting limit reached", fix: "Host adjusts their meeting limit" };
    case "HOST":
      return { meaning: "One or more Collective hosts unavailable", fix: "Make sure all hosts are free" };
    case "ROUNDROBIN":
      return { meaning: "No host available under distribution rules", fix: "Update host availability or distribution" };
    case "UNFAIR":
      return { meaning: "Booking would distribute meetings unfairly", fix: "Adjust distribution settings" };
    case "BUFFER":
      return { meaning: "A buffer is blocking this time", fix: "Edit or remove the buffer" };
    case "PAST":
      return { meaning: "Time is in the past", fix: "Choose a future date" };
    case "RESERVED":
      return { meaning: "A poll, one-off meeting or checkout holds this time", fix: "Clear reserved times" };
    default: {
      const unknown: never = code;
      return { meaning: String(unknown), fix: "" };
    }
  }
}
