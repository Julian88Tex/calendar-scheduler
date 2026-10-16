// OWNER: foundation-ui.
//
// Settings section (SPEC BR-14 narrowed by docs/SCOPE.md): the account settings sub-navigation in groups: "Account"
// (Profile, Branding, My Link, Personas, Login and security: the settings pages docs/SCOPE.md keeps; Notifications, Cookie
// settings, Privacy and Import from Calendly are not built), "Calendar" (links to the Availability tabs: Calendar
// settings, Availability, Advanced) and "Integrations" (the hub). Becomes a select on phones. "Email outbox"
// (golden-path-qa, docs/SCOPE.md item 15) is listed under "Account" for the people who may open it (the owner and
// instance admins; the page itself checks again).
import type * as React from "react";
import { RouteTabs, type RouteTab } from "@/components/ui/route-tabs";
import { getActorCtx } from "@/lib/authz";
import { canSeeEmailOutbox } from "./email-outbox/access";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActorCtx();
  const outbox: RouteTab[] = canSeeEmailOutbox(actor) ? [{ href: "/app/settings/email-outbox", label: "Email outbox", group: "Account" }] : [];
  return (
    <div className="flex min-w-0 flex-col gap-6 md:flex-row md:gap-8">
      <RouteTabs
        aria-label="Account settings"
        orientation="vertical"
        className="md:sticky md:top-4 md:w-56 md:shrink-0 md:self-start"
        tabs={[
          { href: "/app/settings/profile", label: "Profile", group: "Account" },
          { href: "/app/settings/branding", label: "Branding", group: "Account" },
          { href: "/app/settings/link", label: "My Link", group: "Account" },
          { href: "/app/settings/personas", label: "Personas", group: "Account" },
          { href: "/app/settings/login", label: "Login and security", group: "Account" },
          ...outbox,
          { href: "/app/availability/calendar-settings", label: "Calendar settings", group: "Calendar" },
          { href: "/app/availability", label: "Availability", group: "Calendar", exact: true },
          { href: "/app/availability/advanced", label: "Advanced", group: "Calendar" },
          { href: "/app/integrations", label: "Integrations & apps", group: "Integrations" },
        ]}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
