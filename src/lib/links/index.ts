// OWNER: links-sharing. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Links contract (ARCHITECTURE section 25): resolving /d/{code} booking codes (single-use links, one-off meetings and
// shared event types), consuming a link inside the booking transaction (lock order step 2) and one-off hold intervals.
// Foundation stub: no codes resolve (null), consuming is a no-op, no reserved intervals ({}).
import "server-only";
import type { DbOrTx } from "@/db";
import type { BookingTarget } from "@/lib/booking";
import type { BusyInterval } from "@/lib/slots/types";

export type BookingCodeKind = "single_use" | "one_off" | "shared";

export type ResolvedBookingCode = {
  kind: BookingCodeKind;
  code: string;
  eventTypeId: string;
  /** single_use_links.id or one_off_meetings.id (null for shared event types). */
  linkId: string | null;
  /** BK-23 states: used = booked single-use link or booked one-off. */
  status: "active" | "used" | "expired" | "deleted";
  /** The canonical slug of /d/{code}/{slug} (BK-27 301 redirect of other slugs). */
  currentSlug: string;
  /** Single-use overrides (OO-02). */
  overrides?: BookingTarget["overrides"];
  /** One-off offered times (OO-09). */
  spots?: { start: Date; end: Date; overlappedExternalIds: string[] }[];
  /** Single-use link prefill (contact). */
  prefill?: { name: string | null; email: string | null } | null;
};

/** Thrown by consumeLinkInTx when the link or one-off was already used (createBooking returns code "link_used"). */
export class LinkUsedError extends Error {
  readonly code = "link_used" as const;
  constructor(message = "This link has already been used.") {
    super(message);
    this.name = "LinkUsedError";
  }
}

/** Resolves a booking code, or null when no link, one-off or shared event type has it. */
export async function resolveBookingCode(code: string): Promise<ResolvedBookingCode | null> {
  void code;
  return null;
}

/**
 * Lock order step 2 (after the host locks): locks the single-use link or one-off meeting row FOR UPDATE, verifies it
 * is still usable (else throws LinkUsedError) and records the booking (booked_count, status, booked_scheduled_event_id).
 */
export async function consumeLinkInTx(
  tx: DbOrTx,
  p: { kind: "single_use" | "one_off"; id: string; scheduledEventId: string },
): Promise<void> {
  void tx;
  void p;
}

/** One-off holds of pending one-off meetings with reserve times, as reserved busy per user (SCH-19). */
export async function getReservedIntervals(userIds: string[], start: Date, end: Date): Promise<Record<string, BusyInterval[]>> {
  void userIds;
  void start;
  void end;
  return {};
}
