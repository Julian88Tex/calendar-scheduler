// The reschedule page's handling of lifecycle-core answers (SPEC CR-03, SCH-23): refusals reload into the state card,
// taken times show the slot banner, field errors map to the form's keys, success opens the confirmation.
import { describe, expect, it } from "vitest";
import { isChangeRefusal, rescheduleOutcomeOf } from "@/components/lifecycle/lib/outcome";
import messages from "@/lib/i18n/messages/en/lifecycle";

describe("rescheduleOutcomeOf", () => {
  it("maps success to the new invitee", () => {
    expect(rescheduleOutcomeOf({ ok: true, inviteeId: "new", scheduledEventId: "m" })).toEqual({ type: "ok", inviteeId: "new", scheduledEventId: "m", redirectUrl: null });
  });

  it("treats the change rules' refusals as blocked (not as a taken time)", () => {
    expect(rescheduleOutcomeOf({ ok: false, code: "slot_unavailable", message: messages.changes.notReschedulable })).toEqual({ type: "blocked", message: messages.changes.notReschedulable });
    const cutoff = messages.changes.cutoff.replace("{hostName}", "Julian Joseph");
    expect(rescheduleOutcomeOf({ ok: false, code: "validation", message: cutoff })).toEqual({ type: "blocked", message: cutoff });
    expect(isChangeRefusal("Sorry, that time is no longer available.")).toBe(false);
  });

  it("maps a taken time, field errors, verification and other errors", () => {
    expect(rescheduleOutcomeOf({ ok: false, code: "slot_unavailable", message: "Sorry, that time is no longer available." })).toEqual({ type: "slot_taken" });
    expect(rescheduleOutcomeOf({ ok: false, code: "validation", message: "Check the highlighted fields and try again.", fieldErrors: { "invitee.email": ["Enter a valid email address."], "answers.q1": ["Can't be blank."] } })).toEqual({
      type: "fields",
      fieldErrors: { email: "Enter a valid email address.", "answers.q1": "Can't be blank." },
      message: "Check the highlighted fields and try again.",
    });
    expect(rescheduleOutcomeOf({ ok: false, code: "verification_required", message: "Verify", reservationId: "r1" })).toEqual({ type: "verify", reservationId: "r1" });
    expect(rescheduleOutcomeOf({ ok: false, code: "blocked", message: "We couldn't schedule this event." })).toEqual({ type: "error", message: "We couldn't schedule this event." });
  });
});
