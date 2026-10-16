// The Book dialog's extra choices travel to markPollBookedInTx through AsyncLocalStorage (SPEC MP-18, MP-19): the
// booking runs inside booking-core's createBooking transaction, whose markPollBookedInTx contract only carries the ids,
// so bookPoll() wraps the call in runWithBookingIntent() and markPollBookedInTx reads the intent of the same poll in the
// same async call chain (the message to invitees, "Send meeting reminders", "The time has been chosen" emails, auto-book).
// Without an intent (a booking started elsewhere) the defaults apply. Server only.
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

export type BookingIntent = {
  pollId: string;
  message: string | null;
  sendMeetingReminders: boolean;
  notifyExcluded: boolean;
  /** MP-31: booked automatically because everyone agreed. */
  auto: boolean;
};

const storage = new AsyncLocalStorage<BookingIntent>();

export function runWithBookingIntent<T>(intent: BookingIntent, fn: () => Promise<T>): Promise<T> {
  return storage.run(intent, fn);
}

/** The intent of `pollId` in the current call chain, or null. */
export function currentBookingIntent(pollId: string): BookingIntent | null {
  const v = storage.getStore();
  return v && v.pollId === pollId ? v : null;
}
