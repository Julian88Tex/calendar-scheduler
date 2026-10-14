// What the reschedule page does with lifecycle-core's answer (SPEC CR-03, SCH-23). Pure and client safe:
//
//   ok           the new booking: open its confirmation page ("You are rescheduled")
//   blocked      the change rules refused (canceled, started, event type off, cutoff): reload into the state card
//   slot_taken   "Sorry, that time is no longer available." with "View Times" (the booking flow's banner)
//   fields       inline errors with the booking form's keys (name, email, guests, location, answers.{id})
//   verify       a rebook after "Share new times to meet" on an event type with email verification (BK-17)
//   error        any other message
import { interpretBookingResponse, type SubmitOutcome } from "@/components/booking/lib/form";
import lifecycleMessages from "@/lib/i18n/messages/en/lifecycle";
import type { CreateBookingResult } from "@/lib/booking/types";

export type RescheduleOutcome = SubmitOutcome | { type: "blocked"; message: string };

const CUTOFF_PREFIX = lifecycleMessages.changes.cutoff.split("{hostName}")[0]!;

/** True for the change rules' refusals (as opposed to a taken slot or a field error). */
export function isChangeRefusal(message: string | null | undefined): boolean {
  if (!message) return false;
  return message === lifecycleMessages.changes.notReschedulable || (CUTOFF_PREFIX.length > 0 && message.startsWith(CUTOFF_PREFIX));
}

export function rescheduleOutcomeOf(result: CreateBookingResult): RescheduleOutcome {
  if (!result.ok && isChangeRefusal(result.message) && !result.fieldErrors) return { type: "blocked", message: result.message };
  const status = result.ok ? 200 : result.code === "validation" || result.code === "blocked" ? 400 : result.code === "not_found" ? 404 : 409;
  return interpretBookingResponse(status, result);
}
