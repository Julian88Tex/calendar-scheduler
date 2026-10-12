// docs/SCOPE.md guard for the dashboard shell (owner decision: build only what the owner uses). The sidebar, header,
// account, create and help menus, the section tabs and the integrations hub must not link to skipped areas (no nav
// links to skipped areas, no disabled teasers), the in-app Help center and "What's new" describe only kept features
// and follow the copy rules (GEN-11: no em or en dashes; GEN-01: no "Calendly"), and the GEN-16 cron setup helpers and
// the operator mailto links behave.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eventDotColor } from "@/components/public/event-type-list";
import { privacyPolicyHref } from "@/components/public/public-footer-links";
import { mailtoAddress, reportAbuseHref } from "@/components/public/report-abuse";
import { cronLastRunLabel, isCronStale } from "@/components/shell/cron-warning-banner";
import { CHANGELOG, HELP_ARTICLES, reportProblemHref } from "@/components/shell/help-center";
import { ALL_NAV } from "@/components/shell/nav";

const root = path.resolve(__dirname, "../..");

/** Source without comments (doc comments may mention skipped areas to explain why they are absent). */
function code(file: string): string {
  return fs
    .readFileSync(path.join(root, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

const SHELL_FILES = [
  ...fs
    .readdirSync(path.join(root, "src/components/shell"))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => `src/components/shell/${f}`),
  "src/app/(dashboard)/app/layout.tsx",
  "src/app/(dashboard)/app/scheduling/layout.tsx",
  "src/app/(dashboard)/app/availability/layout.tsx",
  "src/app/(dashboard)/app/settings/layout.tsx",
  "src/app/(dashboard)/app/integrations/page.tsx",
  "src/app/(dashboard)/app/_shell/data.ts",
  "src/app/(dashboard)/app/_shell/integrations-hub.tsx",
];

/** Routes of modules docs/SCOPE.md skips (or pages it drops from kept modules). */
const SKIPPED_ROUTES = [
  "/app/contacts",
  "/app/workflows",
  "/app/routing",
  "/app/analytics",
  "/app/admin",
  "/app/teams",
  "/app/one-off",
  "/app/scheduling/single-use-links",
  "/app/settings/notifications",
  "/app/settings/cookies",
  "/app/settings/privacy",
  "/app/settings/import",
  'href="/onboarding"',
  'href="/help"',
  "helpHref=",
  "kind=group",
  "kind=round_robin",
  "kind=collective",
];

describe("docs/SCOPE.md: the shell links only to kept areas", () => {
  it("the sidebar lists Scheduling, Meetings, Availability and Integrations & apps", () => {
    expect(ALL_NAV.map((i) => i.label)).toEqual(["Scheduling", "Meetings", "Availability", "Integrations & apps"]);
    expect(ALL_NAV.some((i) => i.adminOnly)).toBe(false);
  });

  it.each(SHELL_FILES)("%s has no link to a skipped area", (file) => {
    const src = code(file);
    for (const route of SKIPPED_ROUTES) expect(src.includes(route), `${file} links to ${route}`).toBe(false);
  });

  it("the shell offers no team, invite or multi-host entry points", () => {
    const all = SHELL_FILES.map(code).join("\n");
    for (const text of ['"Invite user"', ">Invite user", "Invite users", "Round robin", "Collective", "One-off meeting", "Getting started", "Admin center<"]) {
      expect(all.includes(text), text).toBe(false);
    }
  });

  it("the integrations hub keeps Google Calendar, Google Meet and the email status tile only", () => {
    const src = code("src/app/(dashboard)/app/integrations/page.tsx");
    expect(src).toMatch(/KEPT_INTEGRATION_IDS[^=]*=\s*\["google-calendar", "google-meet", "email"\]/);
  });
});

/** U+2013 and U+2014 (GEN-11), built from char codes so this file stays free of them. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

describe("Help center and What's new copy", () => {
  const texts = [
    ...HELP_ARTICLES.flatMap((a) => [a.title, ...a.paragraphs]),
    ...CHANGELOG.flatMap((s) => [s.title, ...s.items]),
  ];

  it("has unique article ids and non-empty articles", () => {
    expect(new Set(HELP_ARTICLES.map((a) => a.id)).size).toBe(HELP_ARTICLES.length);
    for (const a of HELP_ARTICLES) expect(a.paragraphs.length).toBeGreaterThan(0);
  });

  it("covers the owner's priorities (limits, Google Calendar, Troubleshoot, reminders, reschedule and cancel, polls)", () => {
    const ids = HELP_ARTICLES.map((a) => a.id);
    for (const id of ["limits", "google-calendar", "troubleshoot", "reminders", "reschedule-cancel", "polls"]) expect(ids).toContain(id);
  });

  it("follows the copy rules: no em or en dashes and no competitor name", () => {
    for (const t of texts) {
      expect(t, t).not.toMatch(DASHES);
      expect(t.toLowerCase(), t).not.toContain("calendly");
    }
  });

  it("does not describe skipped features", () => {
    const words = /\b(zoom|teams|outlook|icloud|caldav|ics feed|routing|round robin|collective|group event|single-use|one-off|webhook|api|embed|analytics|sms|text reminder|stripe|payment|contacts|workflow builder|admin center)\b/i;
    for (const t of texts) expect(t, t).not.toMatch(words);
  });
});

describe("GEN-16 cron warning helpers", () => {
  const now = Date.UTC(2026, 9, 12, 12, 0);
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("labels the last run", () => {
    expect(cronLastRunLabel(null, now)).toBe("Never");
    expect(cronLastRunLabel("garbage", now)).toBe("Never");
    expect(cronLastRunLabel(ago(20_000), now)).toBe("Less than a minute ago");
    expect(cronLastRunLabel(ago(60_000), now)).toBe("1 minute ago");
    expect(cronLastRunLabel(ago(20 * 60_000), now)).toBe("20 minutes ago");
    expect(cronLastRunLabel(ago(60 * 60_000), now)).toBe("1 hour ago");
    expect(cronLastRunLabel(ago(47 * 3_600_000), now)).toBe("47 hours ago");
    expect(cronLastRunLabel(ago(3 * 86_400_000), now)).toBe("3 days ago");
    // A tick from a clock slightly ahead never renders a negative age.
    expect(cronLastRunLabel(new Date(now + 5_000).toISOString(), now)).toBe("Less than a minute ago");
  });

  it("is stale at exactly 15 minutes plus one millisecond", () => {
    expect(isCronStale(ago(15 * 60_000), now)).toBe(false);
    expect(isCronStale(ago(15 * 60_000 + 1), now)).toBe(true);
  });
});

describe("operator mailto links (GEN-19, GEN-21)", () => {
  it("keeps a normal address readable and encodes characters that would inject mailto headers", () => {
    expect(mailtoAddress("owner@example.com")).toBe("owner@example.com");
    expect(mailtoAddress(" ops+abuse@example.com ")).toBe("ops%2Babuse@example.com");
    expect(mailtoAddress("a?cc=x@example.com")).toBe("a%3Fcc%3Dx@example.com");
    expect(reportAbuseHref("a&b@example.com", "https://kairos.example/x")).toMatch(/^mailto:a%26b@example\.com\?subject=/);
  });

  it("builds the Report a problem link", () => {
    expect(reportProblemHref("owner@example.com")).toMatch(/^mailto:owner@example\.com\?subject=Report%20a%20problem%20with%20/);
  });
});

describe("public page link and color hardening", () => {
  it("keeps only http(s) or same-site privacy policy links", () => {
    expect(privacyPolicyHref(null)).toBe("/privacy");
    expect(privacyPolicyHref("")).toBe("/privacy");
    expect(privacyPolicyHref("https://example.com/privacy")).toBe("https://example.com/privacy");
    expect(privacyPolicyHref("  http://example.com/p?x=1 ")).toBe("http://example.com/p?x=1");
    expect(privacyPolicyHref("/legal/privacy")).toBe("/legal/privacy");
    expect(privacyPolicyHref("javascript:alert(1)")).toBe("/privacy");
    expect(privacyPolicyHref("JaVaScRiPt:alert(1)")).toBe("/privacy");
    expect(privacyPolicyHref("data:text/html,<script>alert(1)</script>")).toBe("/privacy");
    expect(privacyPolicyHref("//evil.example/privacy")).toBe("/privacy");
    expect(privacyPolicyHref("/\\evil.example")).toBe("/privacy");
    expect(privacyPolicyHref("https://exa mple.com")).toBe("/privacy");
  });

  it("only lets hex event colors into the landing page style attribute", () => {
    expect(eventDotColor("#17e885")).toBe("#17e885");
    expect(eventDotColor("red; background-image: url(https://evil.example/x)")).toBe("#8247f5");
    expect(eventDotColor(null)).toBe("#8247f5");
  });
});
