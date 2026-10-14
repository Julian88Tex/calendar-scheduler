// Server rendering of the invitee page components (SPEC CR-02, CR-03, CR-05, CR-08, SCH-22, SCH-23): the cancel form
// with "Cancel Event?", the guests notice, "Reason for canceling" (asterisk and required when the event type asks for a
// reason), the cancellation policy and "Cancel Event"; the refusal cards (already canceled with "Pick a new time" after
// "Share new times to meet", the cutoff with the host's email, "can no longer be rescheduled" with the cancel link);
// the reschedule details form with "Reason for change", the cancellation policy and "Update Event"; the side panel's
// struck "Former Time" and the locked time zone row.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }) }));

const { CancelPage } = await import("@/components/lifecycle/cancel-page");
const { ChangeStateCard } = await import("@/components/lifecycle/change-state-card");
const { RescheduleDetailsForm } = await import("@/components/lifecycle/reschedule-details-form");
const { RescheduleSidePanel } = await import("@/components/lifecycle/reschedule-side-panel");
const { emptyValues } = await import("@/components/booking/lib/form");
const messages = (await import("@/lib/i18n/messages/en/lifecycle")).default;
type ChangePageView = import("@/components/lifecycle/types").ChangePageView;
type EventView = import("@/components/booking/types").EventView;

const ID = "11111111-1111-4111-8111-111111111111";

const view = (over: Partial<ChangePageView> = {}): ChangePageView => ({
  kind: "cancel",
  inviteeId: ID,
  summary: {
    eventName: "30 Minute Virtual",
    color: "#8247f5",
    host: { variant: "single", person: { id: "h", name: "Julian Joseph", avatarUrl: null } },
    brandHeader: null,
    hostName: "Julian Joseph",
    durationMinutes: 30,
    start: "2030-10-08T17:00:00.000Z",
    end: "2030-10-08T17:30:00.000Z",
    zone: "America/New_York",
    zoneName: "Eastern Time - US & Canada",
    hour12: true,
    whenText: "1:00pm - 1:30pm, Tuesday, October 8, 2030",
    location: null,
    inviteeName: "Ana Lima",
    inviteeEmail: "ana@example.com",
    guestCount: 2,
    canceled: false,
  },
  shell: { branding: {}, ribbon: false, privacyUrl: null, operatorEmail: null },
  blocked: null,
  requireReason: false,
  cancellationPolicy: null,
  scheduleAnotherHref: "/julianjoseph/30min",
  rebook: false,
  ...over,
});

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const cancelAction = async () => ({ ok: true as const, data: { meetingCanceled: true } });

describe("cancel page (CR-02, CR-05)", () => {
  it("renders the summary, 'Cancel Event?', the guests notice, the optional reason and the pill", () => {
    const html = renderToStaticMarkup(createElement(CancelPage, { view: view(), cancelAction }));
    const t = text(html);
    expect(t).toContain("30 Minute Virtual");
    expect(t).toContain("1:00pm - 1:30pm, Tuesday, October 8, 2030");
    expect(t).toContain("Eastern Time - US & Canada");
    expect(t).toContain("Cancel Event?");
    expect(t).toContain("This event will be canceled for Ana Lima and 2 guests.");
    expect(t).toContain("Reason for canceling");
    expect(html).not.toMatch(/<textarea[^>]*required/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>[\s\S]*Cancel Event/);
    expect(html).not.toContain('data-testid="cancellation-policy"');
  });

  it("marks the reason required and shows the cancellation policy when the event type sets them", () => {
    const html = renderToStaticMarkup(createElement(CancelPage, { view: view({ requireReason: true, cancellationPolicy: "Cancel 24 hours ahead.\nNo refunds." }), cancelAction }));
    expect(html).toMatch(/<textarea[^>]*required/);
    expect(html).toMatch(/Reason for canceling<span aria-hidden="true"[^>]*>\*<\/span>/);
    expect(html).toContain('data-testid="cancellation-policy"');
    expect(text(html)).toContain("Cancellation policy Cancel 24 hours ahead. No refunds.");
    // The policy describes the reason field for screen readers.
    const describedBy = /<textarea[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1] ?? "";
    const policyId = /<section id="([^"]+)"[^>]*data-testid="cancellation-policy"/.exec(html)?.[1];
    expect(policyId && describedBy.split(" ")).toContain(policyId);
  });

  it("renders a refusal instead of the form: already canceled, with 'Pick a new time' after a reschedule request (CR-08)", () => {
    const blocked = { reason: "canceled" as const, title: messages.changes.canceled, body: null, contact: null, cancelAvailable: false };
    const plain = text(renderToStaticMarkup(createElement(CancelPage, { view: view({ blocked, summary: { ...view().summary, canceled: true } }), cancelAction })));
    expect(plain).toContain("This event has already been canceled.");
    expect(plain).toContain("Schedule another event");
    expect(plain).not.toContain("Reason for canceling");
    const rebook = renderToStaticMarkup(createElement(CancelPage, { view: view({ blocked, rebook: true }), cancelAction }));
    expect(text(rebook)).toContain("Julian Joseph asked you to pick a new time for this meeting.");
    expect(rebook).toMatch(new RegExp(`href="/reschedulings/${ID}"[^>]*>Pick a new time`));
    expect(text(rebook)).not.toContain("Schedule another event");
  });

  it("shows the SCH-23 cutoff with the host's email", () => {
    const blocked = {
      reason: "cutoff" as const,
      title: messages.changes.cutoff.replace("{hostName}", "Julian Joseph"),
      body: null,
      contact: { name: "Julian Joseph", email: "owner@example.com" },
      cancelAvailable: false,
    };
    const html = renderToStaticMarkup(createElement(CancelPage, { view: view({ blocked }), cancelAction }));
    expect(text(html)).toContain("This meeting can no longer be changed online. Please contact Julian Joseph.");
    expect(html).toContain('href="mailto:owner@example.com"');
    expect(text(html)).toContain("(owner@example.com)");
  });
});

describe("reschedule refusal card (CR-03)", () => {
  it("says the event can no longer be rescheduled and links the cancel page while canceling works", () => {
    const blocked = { reason: "not_reschedulable" as const, title: messages.changes.notReschedulable, body: "Please contact Julian Joseph if you need to change this meeting.", contact: null, cancelAvailable: true };
    const html = renderToStaticMarkup(createElement(ChangeStateCard, { view: view({ kind: "reschedule", blocked }) }));
    expect(text(html)).toContain("This event can no longer be rescheduled.");
    expect(text(html)).toContain("Need to cancel instead? Cancel Event");
    expect(html).toContain(`href="/cancellations/${ID}"`);
    expect(html).toContain('href="/julianjoseph/30min"');
    const noCancel = renderToStaticMarkup(createElement(ChangeStateCard, { view: view({ kind: "reschedule", blocked: { ...blocked, cancelAvailable: false } }) }));
    expect(noCancel).not.toContain("/cancellations/");
  });
});

describe("reschedule details form and side panel (CR-03, CR-05, BK-09, SCH-22)", () => {
  const ctx = { nameFormat: "full" as const, allowGuests: true, locations: [], questions: [] };
  const form = (cancellationPolicy: string | null) =>
    renderToStaticMarkup(
      createElement(RescheduleDetailsForm, {
        ctx,
        values: { ...emptyValues(), name: "Ana Lima", email: "ana@example.com" },
        onChange: () => {},
        reason: "",
        onReasonChange: () => {},
        errors: {},
        formError: null,
        submitting: false,
        onSubmit: () => {},
        collectMarketing: false,
        hostName: "Julian Joseph",
        cancellationPolicy,
        appName: "Kairos",
        termsUrl: null,
        privacyUrl: null,
      }),
    );

  it("adds the optional 'Reason for change', the cancellation policy and 'Update Event'", () => {
    const html = form("Cancel 24 hours ahead.");
    expect(text(html)).toContain("Reason for change");
    expect(html).not.toMatch(/<textarea[^>]*required/);
    expect(text(html)).toContain("Cancellation policy Cancel 24 hours ahead.");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>[\s\S]*Update Event/);
    expect(form(null)).not.toContain("cancellation-policy");
  });

  it("strikes the former time through and shows a locked time zone", () => {
    const event: EventView = {
      id: "e",
      name: "30 Minute Virtual",
      color: "#8247f5",
      kind: "solo",
      durations: [30],
      defaultDuration: 30,
      descriptionHtml: null,
      descriptionText: null,
      locations: [],
      questions: [],
      nameFormat: "full",
      allowGuests: true,
      collectMarketingConsent: false,
      autofill: false,
      showRemainingSpots: false,
      lockedTimeZone: "Europe/Berlin",
      active: true,
      secret: false,
      locale: "en",
    };
    const html = renderToStaticMarkup(
      createElement(RescheduleSidePanel, {
        event,
        host: { variant: "single", person: { id: "h", name: "Julian Joseph", avatarUrl: null } },
        brandHeader: null,
        duration: 30,
        formerText: "3:00pm - 3:30pm, Monday, October 7, 2030",
        zoneName: "Central European Time",
      }),
    );
    expect(html).toMatch(/Former Time[\s\S]*<s[^>]*data-testid="former-when"[^>]*>3:00pm - 3:30pm, Monday, October 7, 2030<\/s>/);
    expect(html).toMatch(/data-testid="details-zone"[^>]*>Central European Time</);
  });
});
