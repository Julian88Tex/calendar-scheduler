// The /cookie-policy and /help pages (SPEC MK-03, MK-04, GEN-19), written for the single-owner deployment: real
// content instead of the "This page is being built." placeholder, indexable, the marketing owner header, every cookie
// the app sets listed by its real name (the constants the code uses), no analytics claims, and no made-up support
// address on the help page (people reach the owner by replying to a booking email).
import fs from "node:fs";
import path from "node:path";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CookiePolicyPage, { metadata as cookieMetadata } from "@/app/(marketing)/cookie-policy/page";
import HelpCenterPage, { metadata as helpMetadata } from "@/app/(marketing)/help/page";
import { COOKIE_CONSENT_TTL_MS } from "@/components/public/cookie-consent";
import { THEME_COOKIE } from "@/components/shell/theme";
import { OAUTH_STATE_COOKIE, OAUTH_STATE_MAX_AGE_SECONDS } from "@/lib/auth/oauth/state";
import { SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_SECONDS } from "@/lib/auth/session";
import { TRUSTED_DEVICE_COOKIE, TRUSTED_DEVICE_MAX_AGE_SECONDS } from "@/lib/booking/verification";
import { EDIT_API_COOKIE, EDIT_COOKIE, EDIT_COOKIE_MAX_AGE_SECONDS, FREEBUSY_COOKIE, FREEBUSY_COOKIE_MAX_AGE_SECONDS } from "@/lib/polls/constants";

const root = path.resolve(__dirname, "../..");
const DAY = 24 * 60 * 60;
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

async function html(Page: (p: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>): Promise<string> {
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
}

/** Visible text: markup and entities removed, whitespace collapsed. */
function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

describe("marketing pages are real and indexable", () => {
  it.each(["cookie-policy", "help"])("/%s has the owner header, no placeholder and no noindex", (slug) => {
    const src = fs.readFileSync(path.join(root, `src/app/(marketing)/${slug}/page.tsx`), "utf8");
    expect(src.split("\n")[0]).toBe("// OWNER: marketing-site. Written for the single-owner deployment.");
    expect(src).not.toContain("being built");
    expect(src).not.toMatch(/robots|noindex/i);
    expect(src).not.toMatch(DASHES);
  });

  it("keeps their titles", () => {
    expect(cookieMetadata.title).toBe("Cookie Policy");
    expect(helpMetadata.title).toBe("Help center");
  });
});

describe("/cookie-policy", () => {
  it("lists every cookie the app sets, by name, with its real lifetime", async () => {
    const page = text(await html(CookiePolicyPage));
    for (const name of [SESSION_COOKIE, OAUTH_STATE_COOKIE, TRUSTED_DEVICE_COOKIE, EDIT_COOKIE, EDIT_API_COOKIE, FREEBUSY_COOKIE, THEME_COOKIE]) {
      expect(page, name).toContain(name);
    }
    expect(SESSION_COOKIE_MAX_AGE_SECONDS).toBe(400 * DAY);
    expect(page).toContain("up to 400 days");
    expect(OAUTH_STATE_MAX_AGE_SECONDS).toBe(10 * 60);
    expect(page).toContain("10 minutes");
    expect(TRUSTED_DEVICE_MAX_AGE_SECONDS).toBe(365 * DAY);
    expect(EDIT_COOKIE_MAX_AGE_SECONDS).toBe(365 * DAY);
    expect(FREEBUSY_COOKIE_MAX_AGE_SECONDS).toBe(30 * 60);
    expect(page).toContain("30 minutes");
    expect(COOKIE_CONSENT_TTL_MS).toBe(365 * DAY * 1000);
  });

  it("explains Cookie settings, offers to open it, and claims no analytics", async () => {
    const markup = await html(CookiePolicyPage);
    const page = text(markup);
    for (const s of ["Cookie settings", "Strictly necessary", "Analytics", "Marketing", "Accept all", "Reject non-essential", "Confirm my choices"]) {
      expect(page, s).toContain(s);
    }
    expect(markup).toMatch(/<button[^>]*>Open cookie settings<\/button>/);
    expect(page).toContain("does not load Google Analytics");
    expect(markup).toContain('href="/privacy"');
  });
});

describe("/help", () => {
  it("covers booking, rescheduling and canceling from the email links, time zones, polls and contacting the owner", async () => {
    const markup = await html(HelpCenterPage);
    const page = text(markup);
    for (const s of [
      "Book a meeting",
      "Schedule Event",
      "Reschedule or cancel",
      "Need to make changes to this event?",
      "Cancel Event",
      "Time zones",
      "Time zone",
      "24 hour clock",
      "Meeting polls",
      "Share times",
      "Edit your preferred times",
      "Contact the owner",
      "reply to any booking",
    ]) {
      expect(page, s).toContain(s);
    }
    for (const id of ["book", "reschedule-cancel", "time-zones", "polls", "contact"]) expect(markup).toContain(`href="#${id}"`);
  });

  it("names no support address", async () => {
    const markup = await html(HelpCenterPage);
    expect(markup).not.toMatch(/mailto:|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });
});
