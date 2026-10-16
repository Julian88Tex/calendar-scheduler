// Reschedule form prefill (SPEC CR-03 "Step 2 is prefilled with the stored name, email, guests, location choice and
// answers (all editable; the location radio keeps the original choice when that option still exists)", BK-07 "the
// picker starts on the original duration when it is still an option"). Pure and client safe. The questions and
// locations are the event type's current ones (the new meeting uses the current settings, SCH-24): stored answers map
// by question id; a choice that is no longer offered becomes the "Other" text when the question has "Other", else it
// is dropped.
import type { QuestionAnswer } from "@/db/types";
import { emptyValues, type FormContext, type FormValues } from "@/components/booking/lib/form";
import { locationInput } from "@/components/booking/lib/locations";

export type StoredInvitee = {
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  marketingConsent: boolean;
  locationAnswer: { configId: string; value?: string | null } | null;
  questionsAndAnswers: QuestionAnswer[] | null;
};

function splitName(name: string): { first: string; last: string } {
  const [first, ...rest] = name.trim().split(/\s+/);
  return { first: first ?? "", last: rest.join(" ") };
}

/** The details form values of a reschedule, from the stored invitee (see the file header). */
export function rescheduleFormValues(inv: StoredInvitee, guests: readonly string[], ctx: FormContext): FormValues {
  const v = emptyValues();
  v.name = inv.name ?? "";
  if (ctx.nameFormat === "first_last") {
    const split = splitName(inv.name ?? "");
    v.firstName = inv.firstName?.trim() || split.first;
    v.lastName = inv.lastName?.trim() || split.last;
  } else {
    v.firstName = inv.firstName ?? "";
    v.lastName = inv.lastName ?? "";
  }
  v.email = inv.email;
  v.guests = ctx.allowGuests ? [...new Set(guests.map((g) => g.trim().toLowerCase()).filter(Boolean))].slice(0, 10) : [];
  v.showGuests = v.guests.length > 0;
  v.marketing = Boolean(inv.marketingConsent);

  // Location: the original choice while the event type still offers it.
  const stored = inv.locationAnswer;
  const match = stored ? ctx.locations.find((l) => l.id === stored.configId) : undefined;
  if (match) {
    if (ctx.locations.length > 1) v.locationId = match.id;
    if (locationInput(match) && stored?.value) v.locationValue = stored.value;
  }

  // Answers by question id.
  for (const q of ctx.questions) {
    const qa = (inv.questionsAndAnswers ?? []).find((a) => a.questionId === q.id);
    if (!qa) continue;
    if (q.type === "multi_select") {
      const values = (qa.values ?? qa.answer.split("\n")).map((s) => s.trim()).filter(Boolean);
      const picked = values.filter((s) => q.answerChoices.includes(s));
      const extra = values.filter((s) => !q.answerChoices.includes(s));
      if (picked.length) v.answers[q.id] = picked;
      if (extra.length && q.includeOther) {
        v.otherSelected[q.id] = true;
        v.other[q.id] = extra.join(", ");
      }
      continue;
    }
    const answer = (qa.answer ?? "").trim();
    if (!answer) continue;
    if (q.type === "single_select" || q.type === "dropdown") {
      if (q.answerChoices.includes(answer)) v.answers[q.id] = answer;
      else if (q.type === "single_select" && q.includeOther) {
        v.otherSelected[q.id] = true;
        v.other[q.id] = answer;
      }
      continue;
    }
    v.answers[q.id] = qa.answer;
  }
  return v;
}

/** BK-07: the original duration while the event type still offers it, else the default. */
export function initialDuration(original: number, offered: readonly number[], fallback: number): number {
  return offered.includes(original) ? original : fallback;
}
