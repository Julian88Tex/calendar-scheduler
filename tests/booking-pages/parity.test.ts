// Calendly parity details of the booking pages (docs/research/calendly-live-capture.md): the phone times view title
// and date, location labels that run on, the legal links' fallbacks (BK-09: /terms and /privacy), the footer copy and
// the terms sentence (its closing period inside the Privacy Notice link), the Calendly-cased copy deck strings, the
// booking icons and the warning icon drawn like Calendly's, the pages' letter spacing and the 40px ribbon band.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BookingFieldError } from "@/components/booking/field-error";
import { BookingLegalNotice, legalNoticeParts, RequiredMark } from "@/components/booking/form-parts";
import { longDate, runOnLabel, weekdayTitle } from "@/components/booking/lib/display";
import { bt } from "@/components/booking/lib/t";
import { legalLinkHref, privacyPolicyHref, PublicFooterLinks } from "@/components/public/public-footer-links";
import { PUBLIC_TEXT_TRACKING } from "@/components/public/booking-card";
import { PoweredByRibbon } from "@/components/public/powered-by-ribbon";
import { CalendarDayIcon, GlobeIcon, VideoCameraIcon } from "@/components/ui/booking-icons";

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
    // Like Calendly, the closing period is part of the bold blue "Privacy Notice." link, not plain text after it.
    expect(html).toContain("Privacy Notice.</a>");
    expect(html).not.toContain("</a>.");
    expect(html.replace(/<[^>]+>/g, "")).toBe("By proceeding, you confirm that you have read and agree to Kairos&#x27;s Participant Terms and Privacy Notice.");
    const configured = renderToStaticMarkup(createElement(BookingLegalNotice, { appName: "Kairos", termsUrl: "https://example.com/t", privacyUrl: "https://example.com/p" }));
    expect(configured).toContain('href="https://example.com/t"');
    expect(configured).toContain('href="https://example.com/p"');
    expect(configured).toContain('rel="noopener noreferrer"');
  });

  it("moves only sentence-ending punctuation right after a link into that link", () => {
    expect(legalNoticeParts("Agree to %%terms%% and %%privacy%%.")).toEqual([
      { kind: "text", text: "Agree to ", trailing: "" },
      { kind: "terms", text: "", trailing: "" },
      { kind: "text", text: " and ", trailing: "" },
      { kind: "privacy", text: "", trailing: "." },
    ]);
    // A translation that puts the links first keeps its text; a longer tail stays plain text.
    expect(legalNoticeParts("%%privacy%% and %%terms%% apply to you.")).toEqual([
      { kind: "privacy", text: "", trailing: "" },
      { kind: "text", text: " and ", trailing: "" },
      { kind: "terms", text: "", trailing: "" },
      { kind: "text", text: " apply to you.", trailing: "" },
    ]);
    expect(legalNoticeParts("No links here.")).toEqual([{ kind: "text", text: "No links here.", trailing: "" }]);
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
    const mark = renderToStaticMarkup(createElement(RequiredMark));
    expect(mark).toContain('aria-hidden="true"');
    // A small navy asterisk (Calendly's is dark, not the gray-blue of secondary text).
    expect(mark).toContain("text-ink");
    expect(mark).not.toContain("text-ink-2");
    const error = renderToStaticMarkup(createElement(BookingFieldError, { id: "e1", error: "Can't be blank." }));
    expect(error).toContain('role="alert"');
    expect(error).toContain('id="e1"');
    expect(error).toContain("Can&#x27;t be blank.");
    expect(renderToStaticMarkup(createElement(BookingFieldError, { error: null }))).toBe("");
    // Calendly's warning icon: a 16x13 triangle with rounded corners (a round-joined outline) and a white "!".
    expect(error).toContain('viewBox="0 0 16 13"');
    expect(error).toContain('stroke-linejoin="round"');
    expect(error).toContain('aria-hidden="true"');
  });
});

describe("booking icons", () => {
  it("draws the globe with a meridian and two latitude lines, decorative and immune to a parent's stroke rule", () => {
    const html = renderToStaticMarkup(createElement(GlobeIcon, { className: "size-4" }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("<ellipse");
    expect(html.match(/M[\d.]+ [\d.]+H[\d.]+/g)).toHaveLength(2);
    // The stroke width sits on the inner group, so BookingDetailRow's [&_svg] stroke-width cannot thicken it.
    expect(html).toMatch(/<g[^>]*stroke-width="2"/);
    const small = renderToStaticMarkup(createElement(GlobeIcon, { radius: 10.5, strokeWidth: 2.2 }));
    expect(small).toContain('r="10.5"');
    expect(small).toMatch(/<g[^>]*stroke-width="2.2"/);
  });

  it("draws the video camera with a square body and leaves its stroke width to the row's rule", () => {
    const html = renderToStaticMarkup(createElement(VideoCameraIcon, { className: "size-4" }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    expect(html).toMatch(/<rect[^>]*width="13.1"[^>]*height="13"/);
    // The stroke width sits on the svg itself (BookingDetailRow's [&_svg] rule may thicken it, as for lucide icons).
    expect(html).toMatch(/<svg[^>]*stroke-width="2"/);
    expect(html).not.toContain("<g");
  });

  it("draws the calendar as an 18x20 page inside a 22px box", () => {
    const html = renderToStaticMarkup(createElement(CalendarDayIcon, {}));
    expect(html).toContain('viewBox="0 0 22 22"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("<rect");
  });
});

describe("public text", () => {
  it("tightens the booking pages' letter spacing and keeps the ribbon's", () => {
    expect(PUBLIC_TEXT_TRACKING).toBe("tracking-[-0.01em]");
    const ribbon = renderToStaticMarkup(createElement(PoweredByRibbon, { appName: "Kairos" }));
    expect(ribbon).toContain('aria-label="Powered by Kairos"');
    // The 40px band (inner edge corner to corner) with its own normal tracking.
    expect(ribbon).toContain("h-10");
    expect(ribbon).toContain("tracking-normal");
  });
});
