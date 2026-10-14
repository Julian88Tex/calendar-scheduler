// OWNER: foundation-ui.
//
// Settings section (SPEC BR-14 narrowed by docs/SCOPE.md): the account settings sub-navigation in groups: "Account"
// (Profile, Branding, My Link, Login and security: the settings pages docs/SCOPE.md keeps; Notifications, Cookie
// settings, Privacy and Import from Calendly are not built), "Calendar" (links to the Availability tabs: Calendar
// settings, Availability, Advanced) and "Integrations" (the hub). Becomes a select on phones.
import type * as React from "react";
import { RouteTabs } from "@/components/ui/route-tabs";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
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
          { href: "/app/settings/login", label: "Login and security", group: "Account" },
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
