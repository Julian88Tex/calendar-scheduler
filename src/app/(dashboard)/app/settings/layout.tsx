// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Settings section (SPEC BR-14): account settings sub-navigation including Import from Calendly.
import type * as React from "react";
import { RouteTabs } from "@/components/ui/route-tabs";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <RouteTabs
        aria-label="Account settings"
        orientation="vertical"
        className="md:w-56 md:shrink-0"
        tabs={[
          { href: "/app/settings/profile", label: "Profile" },
          { href: "/app/settings/branding", label: "Branding" },
          { href: "/app/settings/link", label: "My Link" },
          { href: "/app/settings/login", label: "Login preferences" },
          { href: "/app/settings/notifications", label: "Notifications" },
          { href: "/app/settings/cookies", label: "Cookie settings" },
          { href: "/app/settings/privacy", label: "Privacy" },
          { href: "/app/settings/import", label: "Import from Calendly" },
        ]}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
