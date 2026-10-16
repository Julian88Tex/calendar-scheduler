// Regression tests from the settings review (pure logic): control characters in the profile text (a NUL byte used to
// reach Postgres and fail the save with an internal error), bidirectional override characters in names (email From
// header spoofing), the "yesterday" label of the sessions list across a 23 hour DST day, zones unknown to the
// runtime's Intl data, which link clicks the unsaved changes guard asks about, the caret of the My Link input after
// typing is normalized, and the Profile form following a time zone saved elsewhere (the banner) instead of reverting it.
import { describe, expect, it } from "vitest";
import { formatSessionDate, lastActiveLabel, previousDayKey, safeTimeZone } from "@/components/settings/session-dates";
import { leavesPageInApp } from "@/components/settings/use-unsaved-changes";
import {
  followExternalSave,
  handleCaretAfterSanitize,
  normalizeDisplayName,
  normalizeWelcomeMessage,
  ProfileInput,
  type ProfileFormValues,
} from "@/lib/settings/schemas";

const profile = { name: "Julian Joseph", welcomeMessage: "Hi", timezone: "UTC", timeFormat: "12h", dateFormat: "MM/DD/YYYY" };

describe("profile text normalization", () => {
  it("turns control characters in names into single spaces and drops bidi overrides", () => {
    expect(normalizeDisplayName("Ju\u0000lian\nJoseph\t ")).toBe("Ju lian Joseph");
    expect(normalizeDisplayName("Bank ‮gnp.exe")).toBe("Bank gnp.exe");
    expect(normalizeDisplayName("Ana  Lima")).toBe("Ana Lima");
    // Emoji sequences (zero width joiners) and accents are kept.
    expect(normalizeDisplayName("Zoë \u{1F469}‍\u{1F4BB}")).toBe("Zoë \u{1F469}‍\u{1F4BB}");
  });

  it("keeps line breaks in the welcome message but drops other control characters", () => {
    expect(normalizeWelcomeMessage("Hello\u0000 there\r\nBook\ta time\u0007")).toBe("Hello there\nBook a time");
  });

  it("rejects a name made only of control characters and accepts a NUL inside a name", () => {
    const empty = ProfileInput.safeParse({ ...profile, name: "\u0000\u0001 \n" });
    expect(empty.success).toBe(false);
    if (!empty.success) expect(empty.error.issues[0]?.message).toBe("Enter your name.");
    expect(ProfileInput.parse({ ...profile, name: "Jul\u0000ian", welcomeMessage: "Hi\u0000" })).toMatchObject({ name: "Jul ian", welcomeMessage: "Hi" });
  });
});

describe("session dates", () => {
  it("labels the previous calendar day 'yesterday' right after a spring forward night", () => {
    // America/New_York moved to EDT on 2026-03-08 (a 23 hour day). Now is 00:30 EDT on March 9.
    const nowIso = "2026-03-09T04:30:00.000Z";
    expect(lastActiveLabel("2026-03-08T15:00:00.000Z", "America/New_York", nowIso)).toBe("yesterday");
    expect(lastActiveLabel("2026-03-09T04:10:00.000Z", "America/New_York", nowIso)).toBe("today");
    expect(lastActiveLabel("2026-03-08T04:00:00.000Z", "America/New_York", nowIso)).toBe("Mar 7, 2026");
  });

  it("computes the previous day with calendar arithmetic", () => {
    expect(previousDayKey("2026-03-01")).toBe("2026-02-28");
    expect(previousDayKey("2028-03-01")).toBe("2028-02-29");
    expect(previousDayKey("2026-01-01")).toBe("2025-12-31");
  });

  it("falls back to UTC for a zone the runtime does not know instead of throwing", () => {
    expect(safeTimeZone("Not/AZone")).toBe("UTC");
    expect(safeTimeZone("")).toBe("UTC");
    expect(safeTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
    expect(formatSessionDate("2026-10-12T23:30:00.000Z", "Not/AZone")).toBe("Oct 12, 2026");
    expect(() => lastActiveLabel("2026-10-12T23:30:00.000Z", "Not/AZone", "2026-10-13T08:00:00.000Z")).not.toThrow();
  });
});

describe("unsaved changes guard", () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  const anchor = (href: string, target = "", download = false) => ({ href, target, hasAttribute: (n: string) => n === "download" && download });
  const here = { href: "https://kairos.example.com/app/settings/profile" };

  it("asks for links to other pages of the app", () => {
    expect(leavesPageInApp(click, anchor("https://kairos.example.com/app/settings/branding"), here)).toBe(true);
    expect(leavesPageInApp(click, anchor("/app/scheduling"), here)).toBe(true);
    expect(leavesPageInApp(click, anchor("/app/settings/profile?tab=x"), here)).toBe(true);
  });

  it("does not ask for in-page anchors, new tabs, downloads, modified clicks or other sites", () => {
    expect(leavesPageInApp(click, anchor("/app/settings/profile#picture"), here)).toBe(false);
    expect(leavesPageInApp(click, anchor("/julianjoseph", "_blank"), here)).toBe(false);
    expect(leavesPageInApp(click, anchor("/api/files/x", "", true), here)).toBe(false);
    expect(leavesPageInApp({ ...click, metaKey: true }, anchor("/app/scheduling"), here)).toBe(false);
    expect(leavesPageInApp({ ...click, button: 1 }, anchor("/app/scheduling"), here)).toBe(false);
    expect(leavesPageInApp({ ...click, defaultPrevented: true }, anchor("/app/scheduling"), here)).toBe(false);
    // A full navigation to another site: the browser's beforeunload prompt covers it.
    expect(leavesPageInApp(click, anchor("https://help.example.org/"), here)).toBe(false);
  });
});

describe("My Link caret", () => {
  it("stays where the user typed when the input is normalized", () => {
    // "jul|ian" + "X" -> "julx|ian"; + " " -> "jul-|ian"; a removed character keeps the caret in place.
    expect(handleCaretAfterSanitize("julXian", 4)).toBe(4);
    expect(handleCaretAfterSanitize("jul ian", 4)).toBe(4);
    expect(handleCaretAfterSanitize("jul!ian", 4)).toBe(3);
    // A doubled hyphen collapses: the caret lands after the single hyphen.
    expect(handleCaretAfterSanitize("jul--ian", 5)).toBe(4);
    expect(handleCaretAfterSanitize("Julian", 6)).toBe(6);
    expect(handleCaretAfterSanitize("", 0)).toBe(0);
  });
});

describe("Profile form and changes saved elsewhere", () => {
  const saved: ProfileFormValues = { name: "Julian", welcomeMessage: "Hi", timezone: "America/Los_Angeles", timeFormat: "12h", dateFormat: "MM/DD/YYYY" };

  it("takes the new time zone when the user has not touched it and keeps the user's edits", () => {
    const edited = { ...saved, name: "Julian Joseph" };
    const external = { ...saved, timezone: "America/New_York" };
    expect(followExternalSave(edited, saved, external)).toEqual({ ...saved, name: "Julian Joseph", timezone: "America/New_York" });
  });

  it("keeps a field the user changed even when it also changed elsewhere", () => {
    const edited = { ...saved, timezone: "Europe/Berlin" };
    expect(followExternalSave(edited, saved, { ...saved, timezone: "America/New_York" }).timezone).toBe("Europe/Berlin");
  });
});
