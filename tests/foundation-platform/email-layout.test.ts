// Email layout and content blocks (SPEC NT-05, NT-01 to NT-04): one responsive layout (600px, plain white page,
// logo or avatar, neutral #1A1A1A text, #006BFF pill buttons, "Powered by {AppName}" and the reason line), plain text
// alternatives that match the HTML, valid markup and no tracking pixels.
import { describe, expect, it } from "vitest";
import { composeEmail, renderEmail, type EmailBlock } from "@/lib/email/blocks";
import { escapeHtml, htmlToText, safeHref } from "@/lib/email/html";
import { emailButtonHtml, renderEmailLayout, renderEmailText } from "@/lib/email/layout";
import { formatAddress, isValidEmailAddress, normalizeRecipients, parseAddress, sanitizeHeaderValue } from "@/lib/email/address";

const VOID = new Set(["br", "img", "meta", "hr", "input", "link"]);

/** Every non-void element is closed in order (a cheap well-formedness check for generated markup). */
function assertBalanced(html: string): void {
  const stack: string[] = [];
  const body = html.replace(/<!doctype[^>]*>/i, "").replace(/<style>[\s\S]*?<\/style>/i, "");
  for (const m of body.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)) {
    const tag = m[1]!.toLowerCase();
    if (VOID.has(tag) || m[0].endsWith("/>")) continue;
    if (m[0].startsWith("</")) {
      expect(stack.pop(), `unexpected </${tag}>`).toBe(tag);
    } else stack.push(tag);
  }
  expect(stack).toEqual([]);
}

const confirmationBlocks: EmailBlock[] = [
  { kind: "text", text: "Hi Sam," },
  { kind: "text", text: "Your 30 Minute Meeting with Jordan Lee at 10:00am (Eastern Time - US & Canada) on Tuesday, October 20, 2026 is scheduled." },
  {
    kind: "fields",
    items: [
      { label: "Event", value: "30 Minute Meeting" },
      { label: "Date and time", value: "10:00am - 10:30am, Tuesday, October 20, 2026" },
      { label: "Location", lines: ["This is a Google Meet web conference.", { text: "Join now", href: "https://meet.google.com/abc-defg-hij" }] },
      { label: "Invitee time zone", value: "Eastern Time - US & Canada" },
      { label: "Questions", lines: ["Please share anything that will help prepare for our meeting.", "Looking <forward> & ready"] },
      { label: "Former time", lines: [{ text: "9:00am, Monday, October 19, 2026", strike: true }] },
      { label: "Empty", value: "" },
    ],
  },
  { kind: "notice", tone: "warning", title: "Heads up", text: "You were assigned this meeting." },
  {
    kind: "links",
    text: "Need to make changes to this event?",
    links: [
      { label: "Cancel", url: "http://localhost:3000/cancellations/inv-1" },
      { label: "Reschedule", url: "http://localhost:3000/reschedulings/inv-1" },
      { label: "Bad", url: "javascript:alert(1)" },
    ],
  },
  { kind: "button", label: "View event in Kairos", url: "http://localhost:3000/app/meetings/evt-1" },
  { kind: "divider" },
  { kind: "html", html: "<p>A <strong>rich</strong> description</p>" },
];

describe("renderEmailLayout (NT-05)", () => {
  it("renders the responsive card layout with brand, footer and preheader", () => {
    const { html } = renderEmailLayout({
      preheader: "Your meeting is scheduled.",
      heading: "You are scheduled",
      bodyHtml: "<p>Body</p>",
      brand: { avatarUrl: "https://cdn.example.com/a.png", showPoweredBy: true },
      reason: "You received this email because you scheduled an event.",
      footerLinks: [{ label: "Unsubscribe", url: "https://x.test/u" }],
      locale: "en",
    });
    expect(html).toMatch(/^<!doctype html><html lang="en"/);
    expect(html).toContain("max-width:600px");
    expect(html).toContain("background-color:#FFFFFF");
    expect(html).toContain("color:#1A1A1A");
    expect(html).toContain('src="https://cdn.example.com/a.png"');
    expect(html).toContain("border-radius:50%");
    expect(html).toContain("Powered by Kairos");
    expect(html).toContain("You received this email because you scheduled an event.");
    expect(html).toContain('data-preheader style="display:none');
    expect(html).toContain(">Unsubscribe</a>");
    expect(html).not.toMatch(/<script/i);
    // No tracking pixels: the only image is the avatar.
    expect(html.match(/<img/g)).toHaveLength(1);
    assertBalanced(html);
  });

  it("prefers the logo, hides Powered by when branding is off, and rejects unsafe image URLs and colors", () => {
    const logo = renderEmailLayout({
      bodyHtml: "",
      brand: { logoUrl: "https://cdn.example.com/logo.png", avatarUrl: "https://cdn.example.com/a.png", showPoweredBy: false, primaryColor: "red;x" },
    }).html;
    expect(logo).toContain("logo.png");
    expect(logo).not.toContain("a.png");
    expect(logo).not.toContain("Powered by");
    expect(logo).not.toContain("red;x");
    const unsafe = renderEmailLayout({ bodyHtml: "", brand: { avatarUrl: "javascript:alert(1)", showPoweredBy: true } }).html;
    expect(unsafe).not.toContain("<img");
  });

  it("localizes the footer through the common namespace", () => {
    const { html } = renderEmailLayout({ bodyHtml: "", brand: { showPoweredBy: true }, locale: "pt-BR" });
    expect(html).toContain('lang="pt"');
    expect(html).toContain("Powered by Kairos");
  });

  it("text footer mirrors the HTML footer", () => {
    expect(
      renderEmailText({ heading: "Hello", bodyText: "Body", brand: { showPoweredBy: true }, reason: "Because." }),
    ).toBe("Hello\n\nBody\n\n--\nPowered by Kairos\nBecause.");
    expect(renderEmailText({ bodyText: "Body", brand: { showPoweredBy: false } })).toBe("Body");
  });

  it("buttons are pill shaped Calendly blue and only for absolute links", () => {
    const b = emailButtonHtml("View event", "https://x.test/e");
    expect(b).toContain("border-radius:9999px");
    expect(b).toContain("background:#006BFF");
    expect(emailButtonHtml("x", "/relative")).toBe("");
    expect(emailButtonHtml("x", "https://x.test", "#0A2540")).toContain("background:#0A2540");
  });
});

describe("composeEmail blocks (Calendly notification structure)", () => {
  it("renders matching HTML and text", () => {
    const { html, text } = composeEmail({
      preheader: "Your 30 Minute Meeting with Jordan Lee is scheduled.",
      blocks: confirmationBlocks,
      brand: { avatarUrl: "https://cdn.example.com/a.png", showPoweredBy: true },
      reason: "You received this email because you scheduled an event with Jordan Lee.",
      locale: "en",
    });
    assertBalanced(html);
    expect(html).toContain("Looking &lt;forward&gt; &amp; ready");
    expect(html).toContain('<s style="text-decoration:line-through');
    expect(html).toContain('href="https://meet.google.com/abc-defg-hij"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain(">Empty<");
    expect(html).toContain("<strong>rich</strong>");
    expect(text).toMatchSnapshot();
    expect(html).toMatchSnapshot();
    expect(text).toContain("Location\nThis is a Google Meet web conference.\nJoin now (https://meet.google.com/abc-defg-hij)");
    expect(text).toContain("Need to make changes to this event?\nCancel: http://localhost:3000/cancellations/inv-1\nReschedule: http://localhost:3000/reschedulings/inv-1");
    expect(text).toContain("View event in Kairos: http://localhost:3000/app/meetings/evt-1");
    expect(text).not.toContain("Bad");
    expect(text.endsWith("--\nPowered by Kairos\nYou received this email because you scheduled an event with Jordan Lee.")).toBe(true);
  });

  it("renderEmail returns a header-safe subject", () => {
    const r = renderEmail({ subject: "Confirmed:\n Meeting", blocks: [{ kind: "text", text: "x" }], brand: { showPoweredBy: false } });
    expect(r.subject).toBe("Confirmed: Meeting");
    expect(r.text).toBe("x");
  });
});

describe("htmlToText and escaping", () => {
  it("converts markup to readable text", () => {
    expect(htmlToText('<p>Hi <a href="https://x.test/a">there</a></p>')).toBe("Hi there (https://x.test/a)");
    expect(htmlToText("<p>One</p>\n  <p>Two<br>Three</p><ul><li>A</li><li>B</li></ul>")).toBe("One\n\nTwo\nThree\n\n- A\n- B");
    expect(htmlToText('<a href="https://x.test">https://x.test</a>')).toBe("https://x.test");
    expect(htmlToText('<a href="mailto:a@b.test">a@b.test</a>')).toBe("a@b.test");
    expect(htmlToText('<a href="javascript:x()">Click</a>')).toBe("Click");
    expect(htmlToText('<img src="x" alt="Logo"> <style>p{}</style>&amp; &lt;tag&gt; &#169; &#x41;')).toBe("Logo & <tag> © A");
    expect(htmlToText('<div data-preheader style="display:none">hidden</div><p>shown</p>')).toBe("shown");
  });

  it("escapes HTML and filters unsafe hrefs", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    expect(safeHref("javascript:alert(1)")).toBe("");
    expect(safeHref("mailto:a@b.test")).toBe("mailto:a@b.test");
    expect(safeHref("https://x.test/a")).toBe("https://x.test/a");
  });
});

describe("addresses", () => {
  it("parses, formats and validates mailboxes", () => {
    expect(parseAddress('"Jane \\"J\\" Doe" <jane@example.com>')).toEqual({ name: 'Jane "J" Doe', address: "jane@example.com" });
    expect(parseAddress("Jane <jane@example.com>")).toEqual({ name: "Jane", address: "jane@example.com" });
    expect(parseAddress("jane@example.com")).toEqual({ name: null, address: "jane@example.com" });
    expect(parseAddress("nope")).toBeNull();
    expect(formatAddress('Jane "J"', "jane@example.com")).toBe('"Jane \\"J\\"" <jane@example.com>');
    expect(formatAddress(null, "a@b.test")).toBe("a@b.test");
    expect(isValidEmailAddress("notifications@localhost")).toBe(true);
    expect(isValidEmailAddress("a@@b.test")).toBe(false);
    expect(isValidEmailAddress("a b@c.test")).toBe(false);
    expect(normalizeRecipients(["A@x.test", "a@x.test", "Bob <b@x.test>", "", null, "bad"])).toEqual({
      valid: ["A@x.test", '"Bob" <b@x.test>'],
      invalid: ["bad"],
    });
    expect(sanitizeHeaderValue("a\r\nb\tc")).toBe("a b c");
  });
});
