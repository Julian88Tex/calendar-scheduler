// Pure helpers of the UI kit: time input parsing, chips parsing, color validation, calendar grid math, phone numbers,
// rich text sanitizing, combobox matching, durations, crop geometry, cookie consent, report abuse links and more.
import { describe, expect, it } from "vitest";
import { addChips, splitChips, validateEmailChip } from "@/components/ui/chips-input-utils";
import { filterOptions, groupOptions, normalizeSearchText } from "@/components/ui/combobox-utils";
import { nextSort } from "@/components/ui/data-table";
import { formatRangeLabel, nextRange } from "@/components/ui/date-picker";
import { customDurationMinutes } from "@/components/ui/duration-select";
import { EVENT_COLORS, INVALID_COLOR_MESSAGE, parseHexColor, rotatedEventColor, swatchFor } from "@/components/ui/event-colors";
import { checkImageFile, clampOffset, clampRect, coverScale, outputDimensions, outputType, renamedFile, squareSourceRect } from "@/components/ui/file-upload-utils";
import { addDays, dayLabel, daysBetween, isDateString, monthGrid, monthLabel, shiftMonth, todayIn, weekdayNames } from "@/components/ui/month-calendar-utils";
import { paginationSummary } from "@/components/ui/pagination";
import { detectPhoneCountry, flagEmoji, phoneCountry, PHONE_COUNTRIES, splitE164, toE164 } from "@/components/ui/phone-countries";
import { chipifyVariables, editorHtmlToText, normalizeChipText, normalizeLink, sanitizeEditorHtml } from "@/components/ui/rich-text-utils";
import { activeRouteTab, isRouteActive } from "@/components/ui/route-tabs";
import { formatMinutes, matchTimeOption, parseTimeInput, timeOptions } from "@/components/ui/time-input-utils";
import { parseStoredConsent, COOKIE_CONSENT_TTL_MS } from "@/components/public/cookie-consent";
import { normalizeBrandColor, brandingStyle } from "@/components/public/public-page-shell";
import { reportAbuseHref } from "@/components/public/report-abuse";
import { isCronStale } from "@/components/shell/cron-warning-banner";
import { eventTypeNewHref } from "@/components/shell/create-menu";
import { BOTTOM_NAV, isNavActive, isNavItemActive, PRIMARY_NAV } from "@/components/shell/nav";
import { parseTheme, themeAttribute, themedPath } from "@/components/shell/theme";

describe("TimeInput parsing", () => {
  it.each([
    ["9", 540],
    ["930", 570],
    ["0930", 570],
    ["9:30", 570],
    ["9.30", 570],
    ["9:30 pm", 1290],
    ["9:30pm", 1290],
    ["9:30 PM", 1290],
    ["9:30 p.m.", 1290],
    ["9p", 1260],
    ["9 am", 540],
    ["21:30", 1290],
    ["2130", 1290],
    ["12am", 0],
    ["12:15 am", 15],
    ["12pm", 720],
    ["12", 720],
    ["0", 0],
    ["noon", 720],
    ["midnight", 0],
    ["24:00", 1440],
    ["  5  ", 300],
  ])("parses %j as %d", (text, minutes) => {
    expect(parseTimeInput(text)).toBe(minutes);
  });

  it.each(["", "abc", "9:60", "25", "13pm", "0am", "9:3", "24:30", "12345", "9::30"])("rejects %j", (text) => {
    expect(parseTimeInput(text)).toBeNull();
  });

  it("formats minutes in 12h and 24h", () => {
    expect(formatMinutes(540)).toBe("9:00am");
    expect(formatMinutes(1290)).toBe("9:30pm");
    expect(formatMinutes(0)).toBe("12:00am");
    expect(formatMinutes(720)).toBe("12:00pm");
    expect(formatMinutes(1440)).toBe("12:00am");
    expect(formatMinutes(540, false)).toBe("09:00");
    expect(formatMinutes(1440, false)).toBe("24:00");
    for (const m of [0, 15, 540, 765, 1425]) expect(parseTimeInput(formatMinutes(m))).toBe(m);
  });

  it("lists 15-minute options and matches typed text", () => {
    const opts = timeOptions();
    expect(opts).toHaveLength(96);
    expect(opts[0]).toBe(0);
    expect(opts.at(-1)).toBe(1425);
    expect(timeOptions({ allowEndOfDay: true }).at(-1)).toBe(1440);
    expect(timeOptions({ min: 540, max: 600 })).toEqual([540, 555, 570, 585, 600]);
    expect(matchTimeOption("930", opts)).toBe(570);
    expect(matchTimeOption("9:30 pm", opts)).toBe(1290);
    expect(matchTimeOption("10", opts)).toBe(600);
    expect(matchTimeOption("9:10", opts)).toBe(555);
    expect(matchTimeOption("", opts)).toBeNull();
  });
});

describe("ChipsInput parsing", () => {
  it("splits on commas, semicolons, spaces and new lines", () => {
    expect(splitChips("a@x.com, b@x.com;c@x.com\nd@x.com  e@x.com")).toEqual(["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"]);
    expect(splitChips(" , ; ")).toEqual([]);
  });

  it("adds valid values, skips duplicates case-insensitively and stops at the first invalid value", () => {
    const r = addChips(["a@x.com"], "A@x.com, b@x.com, nope, c@x.com", { validate: validateEmailChip });
    expect(r.values).toEqual(["a@x.com", "b@x.com"]);
    expect(r.added).toEqual(["b@x.com"]);
    expect(r.error).toEqual({ value: "nope", message: "nope is not a valid email address." });
    expect(r.rest).toBe("nope, c@x.com");
  });

  it("enforces the maximum", () => {
    const r = addChips(["a@x.com"], "b@x.com c@x.com", { max: 2 });
    expect(r.values).toEqual(["a@x.com", "b@x.com"]);
    expect(r.error?.message).toBe("You can add up to 2.");
  });

  it("normalizes before validating", () => {
    expect(addChips([], "ANA@Example.com", { normalize: (v) => v.toLowerCase(), validate: validateEmailChip }).values).toEqual(["ana@example.com"]);
  });

  it("validates emails", () => {
    expect(validateEmailChip("ana@example.com")).toBeNull();
    expect(validateEmailChip("ana@example")).not.toBeNull();
    expect(validateEmailChip("ana example@x.com")).not.toBeNull();
    expect(validateEmailChip("<a@x.com>")).not.toBeNull();
  });
});

describe("ColorPicker (SPEC ET-15)", () => {
  it("has the 10 Calendly swatches in order", () => {
    expect(EVENT_COLORS.map((c) => c.value)).toEqual([
      "#ff4f00", "#ff758e", "#e55cff", "#8247f5", "#0099ff", "#0ae8f0", "#17e885", "#ccf000", "#f8e436", "#ffa600",
    ]);
    expect(EVENT_COLORS[3]!.name).toBe("Princely plum");
  });

  it("validates custom hex colors", () => {
    expect(parseHexColor("#8247F5")).toEqual({ ok: true, value: "#8247f5" });
    expect(parseHexColor("8247f5")).toEqual({ ok: true, value: "#8247f5" });
    expect(parseHexColor(" #82f ")).toEqual({ ok: true, value: "#8822ff" });
    for (const bad of ["", "#12345", "#1234567", "#gggggg", "red", "rgb(0,0,0)"]) expect(parseHexColor(bad)).toEqual({ ok: false, error: INVALID_COLOR_MESSAGE });
    expect(INVALID_COLOR_MESSAGE).toBe("Enter a valid color like #8247F5");
  });

  it("rotates new event colors starting with Princely plum and finds swatches", () => {
    expect(rotatedEventColor(0)).toBe("#8247f5");
    expect(rotatedEventColor(1)).toBe("#0099ff");
    expect(rotatedEventColor(7)).toBe("#ff4f00");
    expect(rotatedEventColor(10)).toBe("#8247f5");
    expect(swatchFor("#17E885")?.name).toBe("Loud lime");
    expect(swatchFor("#123456")).toBeNull();
  });
});

describe("MonthCalendar date math", () => {
  it("builds October 2026 with Sunday and Monday week starts", () => {
    const sun = monthGrid("2026-10", 0);
    expect(sun[0]).toEqual([null, null, null, null, "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(sun).toHaveLength(5);
    expect(sun[4]!.filter(Boolean).at(-1)).toBe("2026-10-31");
    const mon = monthGrid("2026-10", 1);
    expect(mon[0]).toEqual([null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(monthGrid("2026-02", 0).flat().filter(Boolean)).toHaveLength(28);
  });

  it("formats the GEN-05 labels", () => {
    expect(dayLabel("2026-10-12")).toBe("Monday, October 12");
    expect(dayLabel("2026-10-04")).toBe("Sunday, October 4");
    expect(monthLabel("2026-10")).toBe("October 2026");
    expect(dayLabel("2026-10-12", "de")).toBe("Montag, 12. Oktober");
    expect(weekdayNames("en", 0)[0]).toEqual({ short: "Sun", long: "Sunday" });
    expect(weekdayNames("en", 1)[0]!.short).toBe("Mon");
  });

  it("shifts months and days across year ends", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("2026-10-14")).toBe(true);
    expect(todayIn("Asia/Kolkata", Date.UTC(2026, 9, 11, 20, 0))).toBe("2026-10-12");
    expect(todayIn("America/New_York", Date.UTC(2026, 9, 11, 2, 0))).toBe("2026-10-10");
  });

  it("selects ranges start then end", () => {
    expect(nextRange({ start: null, end: null }, "2026-10-10")).toEqual({ start: "2026-10-10", end: null });
    expect(nextRange({ start: "2026-10-10", end: null }, "2026-10-12")).toEqual({ start: "2026-10-10", end: "2026-10-12" });
    expect(nextRange({ start: "2026-10-10", end: null }, "2026-10-01")).toEqual({ start: "2026-10-01", end: null });
    expect(nextRange({ start: "2026-10-10", end: "2026-10-12" }, "2026-10-20")).toEqual({ start: "2026-10-20", end: null });
    expect(formatRangeLabel({ start: "2026-10-01", end: "2026-10-31" })).toBe("Oct 1, 2026 - Oct 31, 2026");
  });
});

describe("PhoneInput (E.164)", () => {
  it("builds E.164 numbers", () => {
    expect(toE164("US", "(415) 555-0132")).toBe("+14155550132");
    expect(toE164("US", "1 415 555 0132")).toBe("+14155550132");
    expect(toE164("US", "415 555 013")).toBeNull();
    expect(toE164("GB", "07700 900123")).toBe("+447700900123");
    expect(toE164("DE", "030 1234567")).toBe("+49301234567");
    expect(toE164("IT", "06 1234 5678")).toBe("+390612345678");
    expect(toE164("US", "+44 7700 900123")).toBe("+447700900123");
    expect(toE164("US", "0044 7700 900123")).toBe("+447700900123");
    expect(toE164("US", "")).toBeNull();
    expect(toE164("US", "+1 415")).toBeNull();
  });

  it("detects and splits countries", () => {
    expect(detectPhoneCountry("+447700900123")?.iso).toBe("GB");
    expect(detectPhoneCountry("+14155550132")?.iso).toBe("US");
    expect(detectPhoneCountry("+14165550132", "CA")?.iso).toBe("CA");
    expect(detectPhoneCountry("+12645550132")?.iso).toBe("AI");
    expect(splitE164("+447700900123")).toEqual({ country: phoneCountry("GB"), national: "7700900123" });
    expect(splitE164(null, "DE").country?.iso).toBe("DE");
    expect(flagEmoji("US")).toBe("\u{1F1FA}\u{1F1F8}");
    expect(PHONE_COUNTRIES.length).toBeGreaterThan(200);
    expect(new Set(PHONE_COUNTRIES.map((c) => c.iso)).size).toBe(PHONE_COUNTRIES.length);
  });
});

describe("RichTextEditor sanitizing", () => {
  it("keeps the editor subset and drops everything else", () => {
    expect(sanitizeEditorHtml('<p>Hi <b>there</b> <i>you</i> <u>u</u> <strike>s</strike></p>')).toBe("<p>Hi <strong>there</strong> <em>you</em> <u>u</u> <s>s</s></p>");
    expect(sanitizeEditorHtml('<div>One</div><div>Two<br></div>')).toBe("<p>One</p><p>Two<br></p>");
    expect(sanitizeEditorHtml('<p onclick="x()" style="color:red" class="a">Text</p>')).toBe("<p>Text</p>");
    expect(sanitizeEditorHtml("<script>alert(1)</script><p>ok</p><style>p{}</style>")).toBe("<p>ok</p>");
    expect(sanitizeEditorHtml("<p>a <font color=red>b</font> <img src=x onerror=alert(1)>c</p>")).toBe("<p>a b c</p>");
    expect(sanitizeEditorHtml("<ul><li>One</li><li>Two")).toBe("<ul><li>One</li><li>Two</li></ul>");
    expect(sanitizeEditorHtml("<p>1 &lt; 2 &amp; 3 > 2</p>")).toBe("<p>1 &lt; 2 &amp; 3 &gt; 2</p>");
    expect(sanitizeEditorHtml("<p><br></p><p>&nbsp;</p>")).toBe("");
    expect(sanitizeEditorHtml("<p>Text</p><p><br></p>")).toBe("<p>Text</p>");
    expect(sanitizeEditorHtml("<!-- c --><p>x</p>")).toBe("<p>x</p>");
  });

  it("keeps safe links only", () => {
    expect(sanitizeEditorHtml('<a href="https://example.com" onclick="x">site</a>')).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">site</a>',
    );
    expect(sanitizeEditorHtml('<a href="javascript:alert(1)">x</a>')).toBe("x");
    expect(sanitizeEditorHtml('<a href="java&#x09;script:alert(1)">x</a>')).toBe("x");
    expect(sanitizeEditorHtml('<a href="data:text/html,hi">x</a>')).toBe("x");
    expect(sanitizeEditorHtml('<a href="mailto:a@b.co">mail</a>')).toContain('href="mailto:a@b.co"');
    expect(sanitizeEditorHtml('<a href="https://x.com/?a=1&b=">q</a>')).toContain('href="https://x.com/?a=1&amp;b="');
  });

  it("keeps variable chips and normalizes their text", () => {
    const html = '<p>Hi <span data-variable="invitee_full_name" class="variable chip" contenteditable="false">Invitee full name</span></p>';
    const clean = normalizeChipText(sanitizeEditorHtml(html));
    expect(clean).toBe('<p>Hi <span data-variable="invitee_full_name" class="variable">{{invitee_full_name}}</span></p>');
    expect(sanitizeEditorHtml('<span data-variable="bad key">x</span>')).toBe("x");
    expect(chipifyVariables("<p>Hello {{event_name}} and {{unknown}}</p>", ["event_name"])).toBe(
      '<p>Hello <span data-variable="event_name" class="variable">{{event_name}}</span> and {{unknown}}</p>',
    );
  });

  it("produces plain text", () => {
    expect(editorHtmlToText("<p>Hello</p><p>World<br>line</p>")).toBe("Hello\nWorld\nline");
    expect(editorHtmlToText("<p>List:</p><ul><li>One</li><li>Two</li></ul><ol><li>A</li><li>B</li></ol>")).toBe("List:\n- One\n- Two\n1. A\n2. B");
    expect(editorHtmlToText('<p>Hi <span data-variable="event_name" class="variable">{{event_name}}</span> &amp; bye</p>')).toBe("Hi {{event_name}} & bye");
  });

  it("normalizes typed links", () => {
    expect(normalizeLink("example.com/path")).toBe("https://example.com/path");
    expect(normalizeLink("https://example.com")).toBe("https://example.com");
    expect(normalizeLink("ana@example.com")).toBe("mailto:ana@example.com");
    expect(normalizeLink("javascript:alert(1)")).toBeNull();
    expect(normalizeLink("hello")).toBeNull();
    expect(normalizeLink("")).toBeNull();
  });
});

describe("Combobox matching", () => {
  const options = [
    { value: "America/New_York", label: "Eastern Time - US & Canada", group: "US/CANADA", keywords: ["New York"] },
    { value: "America/Sao_Paulo", label: "Brasilia Time", group: "AMERICA", keywords: ["São Paulo"] },
    { value: "Europe/Berlin", label: "Central European Time", group: "EUROPE" },
  ];
  it("matches every word, ignoring case and accents", () => {
    expect(normalizeSearchText("São_Paulo")).toBe("sao paulo");
    expect(filterOptions(options, "eastern canada").map((o) => o.value)).toEqual(["America/New_York"]);
    expect(filterOptions(options, "sao paulo").map((o) => o.value)).toEqual(["America/Sao_Paulo"]);
    expect(filterOptions(options, "europe").map((o) => o.value)).toEqual(["Europe/Berlin"]);
    expect(filterOptions(options, "  ")).toHaveLength(3);
    expect(groupOptions(options).map((g) => g.group)).toEqual(["US/CANADA", "AMERICA", "EUROPE"]);
  });
});

describe("misc UI helpers", () => {
  it("parses custom durations", () => {
    expect(customDurationMinutes("45", "min")).toBe(45);
    expect(customDurationMinutes("1.5", "hrs")).toBe(90);
    expect(customDurationMinutes("1,25", "hrs")).toBe(75);
    expect(customDurationMinutes("0", "min")).toBeNull();
    expect(customDurationMinutes("13", "hrs")).toBeNull();
    expect(customDurationMinutes("1.33", "hrs")).toBeNull();
    expect(customDurationMinutes("", "min")).toBeNull();
  });

  it("computes crop geometry and output sizes", () => {
    expect(coverScale(1000, 500, 240)).toBeCloseTo(0.48);
    const centered = squareSourceRect(1000, 500, 240, 1, { x: 0, y: 0 });
    expect(centered).toEqual({ x: 250, y: 0, width: 500, height: 500 });
    const zoomed = squareSourceRect(1000, 1000, 240, 2, { x: 0, y: 0 });
    expect(zoomed).toEqual({ x: 250, y: 250, width: 500, height: 500 });
    expect(clampOffset({ x: 500, y: 0 }, 1000, 500, 0.48, 240)).toEqual({ x: 120, y: 0 });
    expect(clampRect({ x: -10, y: 5, width: 500, height: 10 }, { width: 200, height: 100 })).toEqual({ x: 0, y: 5, width: 200, height: 24 });
    expect(outputDimensions(2000, 1000, 800)).toEqual({ width: 800, height: 400 });
    expect(outputDimensions(100, 50, 800)).toEqual({ width: 100, height: 50 });
    expect(outputType("image/png")).toBe("image/png");
    expect(outputType("image/jpeg")).toBe("image/jpeg");
    expect(renamedFile("photo.HEIC.jpeg", "image/png")).toBe("photo.HEIC.png");
    expect(checkImageFile({ type: "image/png", size: 1000 })).toBeNull();
    expect(checkImageFile({ type: "application/pdf", size: 1000 })).toBe("Upload a JPG, PNG, GIF or WebP image.");
    expect(checkImageFile({ type: "image/png", size: 6 * 1024 * 1024 })).toBe("The image must be 5 MB or smaller.");
  });

  it("parses stored cookie consent with the 365 day expiry", () => {
    const at = Date.UTC(2026, 0, 1);
    expect(parseStoredConsent(null)).toBeNull();
    expect(parseStoredConsent("granted")).toEqual({ analytics: true, marketing: true });
    expect(parseStoredConsent("denied")).toEqual({ analytics: false, marketing: false });
    const raw = JSON.stringify({ v: 1, analytics: true, marketing: false, at });
    expect(parseStoredConsent(raw, at + 1000)).toEqual({ analytics: true, marketing: false });
    expect(parseStoredConsent(raw, at + COOKIE_CONSENT_TTL_MS + 1)).toBeNull();
    expect(parseStoredConsent("{bad", at)).toBeNull();
  });

  it("builds the GEN-21 report abuse mailto", () => {
    const href = reportAbuseHref("ops@example.com", "https://kairos.example/julian/30min?month=2026-10");
    expect(href.startsWith("mailto:ops@example.com?subject=")).toBe(true);
    expect(href).toContain(encodeURIComponent("Report abuse: https://kairos.example/julian/30min?month=2026-10"));
    expect(href).toContain("&body=");
  });

  it("normalizes branding colors (BK-26 hex without #)", () => {
    expect(normalizeBrandColor("ff0000")).toBe("#ff0000");
    expect(normalizeBrandColor("#ABC")).toBe("#aabbcc");
    expect(normalizeBrandColor("red")).toBeNull();
    expect(normalizeBrandColor("")).toBeNull();
    expect(brandingStyle({ primaryColor: "ff0000", textColor: "nope" })).toEqual({ "--primary-color": "#ff0000" });
  });

  it("flags a stale cron tick after 15 minutes", () => {
    const now = Date.UTC(2026, 9, 12, 12, 0);
    expect(isCronStale(null, now)).toBe(true);
    expect(isCronStale(new Date(now - 14 * 60_000).toISOString(), now)).toBe(false);
    expect(isCronStale(new Date(now - 16 * 60_000).toISOString(), now)).toBe(true);
    expect(isCronStale("garbage", now)).toBe(true);
  });

  it("sorts, paginates and matches route tabs", () => {
    expect(nextSort(null, "name")).toEqual({ columnId: "name", direction: "asc" });
    expect(nextSort({ columnId: "name", direction: "asc" }, "name")).toEqual({ columnId: "name", direction: "desc" });
    expect(nextSort({ columnId: "name", direction: "desc" }, "email")).toEqual({ columnId: "email", direction: "asc" });
    expect(paginationSummary(2, 25, 120)).toBe("26-50 of 120");
    expect(paginationSummary(5, 25, 120)).toBe("101-120 of 120");
    expect(paginationSummary(1, 25, 0)).toBe("0 of 0");
    expect(paginationSummary(3, 25)).toBe("Page 3");
    const tabs = [
      { href: "/app/availability" as const, exact: true },
      { href: "/app/availability/calendar-settings" as const },
    ];
    expect(isRouteActive("/app/availability/calendar-settings", tabs[1]!)).toBe(true);
    expect(isRouteActive("/app/availability/calendar-settings", tabs[0]!)).toBe(false);
    expect(activeRouteTab("/app/availability", tabs)).toBe(tabs[0]);
    expect(activeRouteTab("/app/admin", tabs)).toBeUndefined();
  });

  it("orders the dashboard navigation per GEN-20, limited to the areas docs/SCOPE.md keeps", () => {
    expect(PRIMARY_NAV.map((i) => [i.label, i.href])).toEqual([
      ["Scheduling", "/app/scheduling"],
      ["Meetings", "/app/meetings"],
      ["Availability", "/app/availability"],
      ["Integrations & apps", "/app/integrations"],
    ]);
    expect(BOTTOM_NAV).toEqual([]);
    expect(isNavActive("/app/availability/advanced", "/app/availability")).toBe(true);
    expect(isNavActive("/app/scheduling/meeting-polls", "/app/scheduling")).toBe(true);
    expect(isNavActive("/app/availabilityx", "/app/availability")).toBe(false);
    // The event type editor and meeting poll pages keep Scheduling active.
    const scheduling = PRIMARY_NAV[0]!;
    expect(isNavItemActive("/app/event-types/new", scheduling)).toBe(true);
    expect(isNavItemActive("/app/polls/abc/edit", scheduling)).toBe(true);
    expect(isNavItemActive("/app/pollsx", scheduling)).toBe(false);
    expect(isNavItemActive("/app/event-types/new", PRIMARY_NAV[2]!)).toBe(false);
  });

  it("builds the ET-02 create links", () => {
    expect(eventTypeNewHref("one_on_one")).toBe("/app/event-types/new?kind=one_on_one");
    expect(eventTypeNewHref("round_robin", { scope: "shared" })).toBe("/app/event-types/new?kind=round_robin&scope=shared");
    expect(eventTypeNewHref("collective", { scope: "team", teamId: "t 1" })).toBe("/app/event-types/new?kind=collective&scope=team&teamId=t%201");
  });

  it("applies the dashboard theme only on dashboard paths (GEN-22)", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("weird")).toBe("light");
    expect(themeAttribute("light")).toBeUndefined();
    expect(themeAttribute("dark")).toBe("dark");
    expect(themedPath("/app/scheduling")).toBe(true);
    expect(themedPath("/app")).toBe(true);
    expect(themedPath("/julianjoseph/30min")).toBe(false);
    expect(themedPath("/apple")).toBe(false);
    expect(themedPath(null)).toBe(false);
  });
});
