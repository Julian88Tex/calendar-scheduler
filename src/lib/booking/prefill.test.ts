// BK-15 prefill parsing.
import { describe, expect, it } from "vitest";
import { parsePrefill, type PrefillQuestion } from "./prefill";

const questions: PrefillQuestion[] = [
  { id: "q-text", position: 0, type: "text", answerChoices: [] },
  { id: "q-radio", position: 1, type: "single_select", answerChoices: ["Red", "Green", "Blue"] },
  { id: "q-check", position: 2, type: "multi_select", answerChoices: ["A", "B", "C"] },
  { id: "q-drop", position: 3, type: "dropdown", answerChoices: ["Small", "Large"] },
  { id: "q-phone", position: 4, type: "phone_number", answerChoices: [] },
  { id: "q-off", position: 5, type: "string", answerChoices: [], enabled: false },
  { id: "q-line", position: 6, type: "string", answerChoices: [] },
];

describe("parsePrefill", () => {
  it("fills name, email and the first answer from the BK-15 acceptance URL", () => {
    const p = parsePrefill(new URLSearchParams("name=Ana%20Lima&email=ana@example.com&a1=Hello"), { questions });
    expect(p.name).toBe("Ana Lima");
    expect(p.email).toBe("ana@example.com");
    expect(p.answers).toEqual({ "q-text": "Hello" });
  });

  it("maps a1 to a10 by question order with option indexes for radios and checkboxes", () => {
    const p = parsePrefill(
      { a1: "Multi\nline", a2: "2", a3: "1,3,9", a4: "Large", a5: "+1 415 555 0123", a6: "Visible line" },
      { questions },
    );
    expect(p.answers).toEqual({
      "q-text": "Multi\nline",
      "q-radio": "Green",
      "q-check": ["A", "C"],
      "q-drop": "Large",
      "q-phone": "+1 415 555 0123",
      // disabled questions are not rendered, so a6 targets the next enabled question
      "q-line": "Visible line",
    });
  });

  it("ignores invalid values silently", () => {
    const p = parsePrefill(
      { email: "not-an-email", a2: "7", a3: "x,0", a4: "large", a5: "call me", duration: "45", routing_form_submission: "nope" },
      { questions, durationOptions: [30, 60] },
    );
    expect(p.email).toBeUndefined();
    expect(p.answers).toEqual({});
    expect(p.durationMinutes).toBeUndefined();
    expect(p.routingFormSubmissionId).toBeUndefined();
  });

  it("radios take exactly one option index", () => {
    expect(parsePrefill({ a2: "1,2" }, { questions }).answers).toEqual({});
  });

  it("reads first and last name, location, guests, tracking, duration and routing submission", () => {
    const p = parsePrefill(
      new URLSearchParams({
        first_name: "Ana",
        last_name: "Lima",
        email: "ana@example.com",
        location: "+14155550123",
        guests: "bo@example.com, ana@example.com,bad, cy@example.com,bo@example.com",
        utm_source: "newsletter",
        utm_medium: "email",
        utm_campaign: "fall",
        utm_content: "cta",
        utm_term: "meeting",
        salesforce_uuid: "sf-1",
        duration: "60",
        routing_form_submission: "0B0E6F2A-1C2D-4E5F-8A9B-0C1D2E3F4A5B",
      }),
      { questions, durationOptions: [30, 60] },
    );
    expect(p.firstName).toBe("Ana");
    expect(p.lastName).toBe("Lima");
    expect(p.location).toBe("+14155550123");
    expect(p.guests).toEqual(["bo@example.com", "cy@example.com"]);
    expect(p.tracking).toEqual({
      utmSource: "newsletter",
      utmMedium: "email",
      utmCampaign: "fall",
      utmContent: "cta",
      utmTerm: "meeting",
      salesforceUuid: "sf-1",
    });
    expect(p.durationMinutes).toBe(60);
    expect(p.routingFormSubmissionId).toBe("0b0e6f2a-1c2d-4e5f-8a9b-0c1d2e3f4a5b");
  });

  it("caps guests at 10 and takes the first value of repeated Next search params", () => {
    const many = Array.from({ length: 14 }, (_, i) => `g${i}@example.com`).join(",");
    const p = parsePrefill({ guests: many, name: ["First", "Second"] });
    expect(p.guests).toHaveLength(10);
    expect(p.name).toBe("First");
  });

  it("never prefills the SMS number or Other texts", () => {
    const p = parsePrefill({ text_reminder_number: "+14155550123", a2: "Purple" }, { questions });
    expect(p).not.toHaveProperty("textReminderNumber");
    expect(p.answers).toEqual({});
  });
});
