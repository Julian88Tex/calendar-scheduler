// Calendly parity details of the booking pages (docs/research/calendly-live-capture.md): the phone times view title
// and date, location labels that run on, the legal links' fallbacks (BK-09: /terms and /privacy), the footer copy and
// the terms sentence, and the Calendly-cased copy deck strings.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BookingFieldError } from "@/components/booking/field-error";
import { BookingLegalNotice, RequiredMark } from "@/components/booking/form-parts";
import { longDate, runOnLabel, weekdayTitle } from "@/components/booking/lib/display";
import { bt } from "@/components/booking/lib/t";
import { legalLinkHref, privacyPolicyHref, PublicFooterLinks } from "@/components/public/public-footer-links";

describe("phone times view header", () => {
  it("titles the day with its weekday and shows the full date with the year", () => {
    expect(weekdayTitle("2026-10-15")).toBe("Thursday");
    expect(longDate("2026-10-15")).toBe("October 15, 2026");
  });

  it("never shifts the date with the runtime zone (dates are local YYYY-MM-DD strings)", () => {
    expect(weekdayTitle("2026-03-08")).toBe("Sunday");
    expect(longDate("2026-12-31")).toBe("December 31, 2026");
    expect(longDate("2027-01-01")).toBe("January 1, 2027");
  });

  it("formats the duration line and the visible heading", () => {
    expect(bt("page.durationLine", { duration: "30 min" })).toBe("Duration: 30 min");
    expect(bt("page.selectTimeHeading")).toBe("Select a Time");
    expect(bt("page.selectDay")).toBe("Select a Day");
    // The list keeps its accessible name (other modules' tests and assistive technology rely on it).
    expect(bt("page.selectTime")).toBe("Select a time");
  });
});

describe("location labels", () => {
  it("runs the stored newline before the notes on as a space", () => {
    expect(runOnLabel("The Reading Club - Embarcadero - $$$\n[Business Casual Dress Code]")).toBe("The Reading Club - Embarcadero - $$$ [Business Casual Dress Code]");
    expect(runOnLabel("Cafe  \r\n  [Notes]")).toBe("Cafe [Notes]");
    expect(runOnLabel("Somewhere else")).toBe("Somewhere else");
  });
});

describe("legal links", () => {
  it("falls back to the app's own pages for missing or unsafe URLs", () => {
    expect(legalLinkHref(null, "/terms")).toBe("/terms");
    expect(legalLinkHref("  ", "/terms")).toBe("/terms");
    expect(legalLinkHref("javascript:alert(1)", "/terms")).toBe("/terms");
    expect(legalLinkHref("//evil.example/terms", "/terms")).toBe("/terms");
    expect(legalLinkHref("https://example.com/legal/terms", "/terms")).toBe("https://example.com/legal/terms");
    expect(legalLinkHref("/legal", "/terms")).toBe("/legal");
    expect(privacyPolicyHref(undefined)).toBe("/privacy");
  });

  it("always renders the terms sentence with the brand's Participant Terms and the Privacy Notice", () => {
    const html = renderToStaticMarkup(createElement(BookingLegalNotice, { appName: "Kairos", termsUrl: null, privacyUrl: null }));
    expect(html).toContain("By proceeding, you confirm that you have read and agree to ");
    expect(html).toContain('href="/terms"');
    expect(html).toContain("Kairos&#x27;s Participant Terms</a>");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain("Privacy Notice</a>");
    const configured = renderToStaticMarkup(createElement(BookingLegalNotice, { appName: "Kairos", termsUrl: "https://example.com/t", privacyUrl: "https://example.com/p" }));
    expect(configured).toContain('href="https://example.com/t"');
    expect(configured).toContain('href="https://example.com/p"');
    expect(configured).toContain('rel="noopener noreferrer"');
  });

  it("uses Calendly's casing for the guests copy", () => {
    expect(bt("details.addGuests")).toBe("Add guests");
    expect(bt("details.guestEmails")).toBe("Guest email(s)");
  });
});

describe("footer links", () => {
  it("shows Cookie settings and Privacy Policy, and Report abuse only with an operator email", () => {
    const html = renderToStaticMarkup(createElement(PublicFooterLinks, { showPrivacyPolicy: true, privacyUrl: null, pageUrl: "https://kairos.example/x" }));
    expect(html).toContain("Cookie settings");
    expect(html).toContain('href="/privacy"');
    expect(html).not.toContain("Report abuse");
    const phone = renderToStaticMarkup(createElement(PublicFooterLinks, { showPrivacyPolicy: false, listenForOpenEvent: false, pageUrl: "https://kairos.example/x" }));
    expect(phone).toContain("Cookie settings");
    expect(phone).not.toContain("Privacy Policy");
  });
});

describe("form parts", () => {
  it("renders the required mark as decoration and errors as alerts", () => {
    expect(renderToStaticMarkup(createElement(RequiredMark))).toContain('aria-hidden="true"');
    const error = renderToStaticMarkup(createElement(BookingFieldError, { id: "e1", error: "Can't be blank." }));
    expect(error).toContain('role="alert"');
    expect(error).toContain('id="e1"');
    expect(error).toContain("Can&#x27;t be blank.");
    expect(renderToStaticMarkup(createElement(BookingFieldError, { error: null }))).toBe("");
  });
});
