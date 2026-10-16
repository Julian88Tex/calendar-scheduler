// OWNER: foundation-ui.
//
// Availability section (SPEC AV-01, CAL-01, walkthrough 9.1): the "Availability" page header and the tabs Schedules |
// Calendar settings | Advanced settings.
import type * as React from "react";
import { PageHeader } from "@/components/ui/page-header";
import { RouteTabs } from "@/components/ui/route-tabs";

export default function AvailabilityLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Availability" />
      <RouteTabs
        aria-label="Availability"
        className="mb-6"
        tabs={[
          { href: "/app/availability", label: "Schedules", exact: true },
          { href: "/app/availability/calendar-settings", label: "Calendar settings" },
          { href: "/app/availability/advanced", label: "Advanced settings" },
        ]}
      />
      {children}
    </>
  );
}
