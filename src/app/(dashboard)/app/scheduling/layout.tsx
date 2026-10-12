// OWNER: foundation-ui.
//
// Scheduling section (SPEC ET-01, ET-02, GEN-20, walkthrough 5.1, docs/SCOPE.md): the "Scheduling" page header with
// the "+ Create" button (the same menu as the sidebar) and the tabs Event types | Meeting polls (the Single-use links
// tab belongs to links-sharing, which docs/SCOPE.md does not build).
import type * as React from "react";
import { CreateMenu } from "@/components/shell/create-menu";
import { PageHeader } from "@/components/ui/page-header";
import { RouteTabs } from "@/components/ui/route-tabs";

export default function SchedulingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Scheduling" actions={<CreateMenu variant="header" align="end" />} />
      <RouteTabs
        aria-label="Scheduling"
        className="mb-6"
        tabs={[
          { href: "/app/scheduling", label: "Event types", exact: true },
          { href: "/app/scheduling/meeting-polls", label: "Meeting polls" },
        ]}
      />
      {children}
    </>
  );
}
