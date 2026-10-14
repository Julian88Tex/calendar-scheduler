// OWNER: polls-core.
//
// Polls contract (ARCHITECTURE section 25): poll hold intervals for the availability service and the poll booking
// step inside booking-core's transaction (lock order step 2: the poll row after the host locks). The module's other
// server services are in ./server.ts, its Server Actions in ./actions.ts.
import "server-only";
import type { DbOrTx } from "@/db";
import type { BusyInterval } from "@/lib/slots/types";
import { markPollBooked } from "./booked";
import { reservedIntervalsByUser } from "./holds";

/**
 * Holds of open or closed polls with reserve times, as reserved busy per user (SCH-19): the options' times (date-only
 * options: the whole local day in the poll's zone), titled "Reserved: {poll title}". Additive `opts.db`: callers inside
 * a transaction (the booking recheck) pass their transaction handle so the read runs in it.
 */
export async function getPollReservedIntervals(
  userIds: string[],
  start: Date,
  end: Date,
  opts: { db?: DbOrTx } = {},
): Promise<Record<string, BusyInterval[]>> {
  return reservedIntervalsByUser(userIds, start, end, opts);
}

/**
 * Locks the poll row FOR UPDATE (after the host locks), validates it is open or closed and not booked, and marks it
 * booked with the chosen option and the new scheduled event (activity, poll.booked, side effect jobs in the same
 * transaction). Throws AppError("conflict") to roll the booking back.
 */
export async function markPollBookedInTx(
  tx: DbOrTx,
  p: { pollId: string; optionId: string; scheduledEventId: string; inviteeIds: string[]; bookedByUserId: string },
): Promise<void> {
  await markPollBooked(tx, p);
}
