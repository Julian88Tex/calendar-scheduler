// Reschedule form prefill (SPEC CR-03, BK-07): stored name, email, guests, location choice and answers mapped onto the
// event type's current questions and locations. Pure (src/components/lifecycle/lib/prefill.ts).
import { describe, expect, it } from "vitest";
import type { FormContext } from "@/components/booking/lib/form";
import { initialDuration, rescheduleFormValues, type StoredInvitee } from "@/components/lifecycle/lib/prefill";

const MEET = { id: "loc-meet", kind: "google_conference" as const, position: 0, text: null, additionalInfo: null, prompt: null };
const CAFE = { id: "loc-cafe", kind: "physical" as const, position: 1, text: "Blue Bottle", additionalInfo: "66 Mint St", prompt: null };
const ASK = { id: "loc-ask", kind: "ask_invitee" as const, position: 2, text: null, additionalInfo: null, prompt: "Suggest a place" };

const ctx = (over: Partial<FormContext> = {}): FormContext => ({
  nameFormat: "full",
  allowGuests: true,
  locations: [MEET, CAFE, ASK],
  questions: [
    { id: "q-text", label: "What would you like to discuss?", type: "text", required: true, answerChoices: [], includeOther: false, position: 0 },
    { id: "q-radio", label: "Size", type: "single_select", required: false, answerChoices: ["Small", "Large"], includeOther: true, position: 1 },
    { id: "q-check", label: "Topics", type: "multi_select", required: false, answerChoices: ["Roadmap", "Pricing"], includeOther: false, position: 2 },
    { id: "q-drop", label: "Team", type: "dropdown", required: false, answerChoices: ["Sales", "Support"], includeOther: false, position: 3 },
  ],
  ...over,
});

const stored = (over: Partial<StoredInvitee> = {}): StoredInvitee => ({
  name: "Ana Lima",
  firstName: "Ana",
  lastName: "Lima",
  email: "Ana@Example.com",
  marketingConsent: true,
  locationAnswer: { configId: "loc-cafe", value: null },
  questionsAndAnswers: [
    { questionId: "q-text", question: "What would you like to discuss?", type: "text", position: 0, answer: "Roadmap review" },
    { questionId: "q-radio", question: "Size", type: "single_select", position: 1, answer: "Medium" },
    { questionId: "q-check", question: "Topics", type: "multi_select", position: 2, answer: "Roadmap\nHiring", values: ["Roadmap", "Hiring"] },
    { questionId: "q-drop", question: "Team", type: "dropdown", position: 3, answer: "Marketing" },
    { questionId: "q-gone", question: "Old question", type: "string", position: 4, answer: "ignored" },
  ],
  ...over,
});

describe("rescheduleFormValues", () => {
  it("prefills name, email (as typed), guests, the original location and the answers", () => {
    const v = rescheduleFormValues(stored(), ["b@example.com", "B@example.com", "c@example.com"], ctx());
    expect(v.name).toBe("Ana Lima");
    expect(v.email).toBe("Ana@Example.com");
    expect(v.guests).toEqual(["b@example.com", "c@example.com"]);
    expect(v.showGuests).toBe(true);
    expect(v.locationId).toBe("loc-cafe");
    expect(v.locationValue).toBe("");
    expect(v.marketing).toBe(true);
    expect(v.answers["q-text"]).toBe("Roadmap review");
    // "Medium" is no longer a choice: it becomes the "Other" text of a question with "Other".
    expect(v.answers["q-radio"]).toBeUndefined();
    expect(v.otherSelected["q-radio"]).toBe(true);
    expect(v.other["q-radio"]).toBe("Medium");
    // Checkboxes keep the choices still offered; without "Other" the rest is dropped.
    expect(v.answers["q-check"]).toEqual(["Roadmap"]);
    expect(v.otherSelected["q-check"]).toBeUndefined();
    // A dropdown answer that is no longer offered is dropped.
    expect(v.answers["q-drop"]).toBeUndefined();
    expect(v.answers["q-gone"]).toBeUndefined();
  });

  it("keeps the invitee's own text for ask-invitee and the phone for outbound calls", () => {
    const v = rescheduleFormValues(stored({ locationAnswer: { configId: "loc-ask", value: "My office" } }), [], ctx());
    expect(v.locationId).toBe("loc-ask");
    expect(v.locationValue).toBe("My office");
    const phone = { id: "loc-call", kind: "outbound_call" as const, position: 0, text: null, additionalInfo: null, prompt: null };
    const single = rescheduleFormValues(stored({ locationAnswer: { configId: "loc-call", value: "+14155550123" } }), [], ctx({ locations: [phone] }));
    expect(single.locationId).toBeNull(); // one option: chosen implicitly
    expect(single.locationValue).toBe("+14155550123");
  });

  it("leaves the location unchosen when the original option is gone (CR-03)", () => {
    const v = rescheduleFormValues(stored({ locationAnswer: { configId: "deleted", value: "x" } }), [], ctx());
    expect(v.locationId).toBeNull();
    expect(v.locationValue).toBe("");
  });

  it("splits a full name for first and last name forms, and drops guests when the event type disallows them", () => {
    const v = rescheduleFormValues(stored({ firstName: null, lastName: null, name: "Ana Maria Lima" }), ["b@example.com"], ctx({ nameFormat: "first_last", allowGuests: false }));
    expect(v.firstName).toBe("Ana");
    expect(v.lastName).toBe("Maria Lima");
    expect(v.guests).toEqual([]);
    expect(v.showGuests).toBe(false);
  });
});

describe("initialDuration (BK-07)", () => {
  it("starts on the original duration when it is still offered, else the default", () => {
    expect(initialDuration(60, [30, 60, 90], 30)).toBe(60);
    expect(initialDuration(45, [30, 60], 30)).toBe(30);
  });
});
