// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Scheduling section (SPEC ET-01, GEN-20): page header with "+ Create" and the tabs Event types | Single-use links |
// Meeting polls.
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
          { href: "/app/scheduling/single-use-links", label: "Single-use links" },
          { href: "/app/scheduling/meeting-polls", label: "Meeting polls" },
        ]}
      />
      {children}
    </>
  );
}
