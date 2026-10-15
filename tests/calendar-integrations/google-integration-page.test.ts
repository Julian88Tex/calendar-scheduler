// Integrations > Google Calendar (SPEC CAL-21; docs/SCOPE.md): the Permissions card lists what the Google connection
// may do, including Gmail sending (gmail.send is requested with the calendar scopes: send only, never reading mail).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/calendars/actions", () => ({ disconnectCalendar: async () => ({ ok: true, data: {} }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/app/integrations/calendars/google",
  useSearchParams: () => new URLSearchParams(),
}));

const { GoogleCalendarIntegration } = await import("@/components/calendars/google-calendar-integration");

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/\s+/g, " ");
}

describe("Google Calendar integration page", () => {
  it("lists Gmail sending (send only) with the calendar permissions", () => {
    const view = { connections: [], destinationCalendarId: null, googleConfigured: true, pushNotifications: false, softLimit: 6, maxAccounts: 6 };
    const html = renderToStaticMarkup(createElement(GoogleCalendarIntegration, { view, appName: "Kairos", isAdmin: true }));
    const t = text(html);
    expect(t).toContain("See your calendars and the events on them, to find busy times.");
    expect(t).toContain("Create, change and delete the events you schedule here.");
    expect(t).toContain("Send booking emails from your Gmail address (send only: it can't read your mail).");
  });
});
