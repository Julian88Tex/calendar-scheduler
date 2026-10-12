// OWNER: polls-core. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Polls contract (ARCHITECTURE section 25): poll hold intervals for the availability service and the poll booking
// step inside booking-core's transaction (lock order step 2: the poll row after the host locks).
// Foundation stub: no reserved intervals ({}); markPollBookedInTx throws AppError("not_configured").
import "server-only";
import type { DbOrTx } from "@/db";
import { AppError } from "@/lib/errors";
import type { BusyInterval } from "@/lib/slots/types";

/** Holds of open or closed polls with reserve times, as reserved busy per user (SCH-19). */
export async function getPollReservedIntervals(
  userIds: string[],
  start: Date,
  end: Date,
): Promise<Record<string, BusyInterval[]>> {
  void userIds;
  void start;
  void end;
  return {};
}

/**
 * Locks the poll row FOR UPDATE (after the host locks), validates it is open or closed and not booked, and marks it
 * booked with the chosen option and the new scheduled event.
 */
export async function markPollBookedInTx(
  tx: DbOrTx,
  p: { pollId: string; optionId: string; scheduledEventId: string; inviteeIds: string[]; bookedByUserId: string },
): Promise<void> {
  void tx;
  void p;
  throw new AppError("not_configured", "Meeting polls are not available yet.");
}
