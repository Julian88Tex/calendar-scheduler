// OWNER: foundation-ui.
//
// Scheduling section (SPEC ET-01, ET-02, GEN-20, walkthrough 5.1): the "Scheduling" page header with the "+ Create"
// button (the same menu as the sidebar) and the tabs Event types | Single-use links | Meeting polls.
import type * as React from "react";
import { CreateMenu } from "@/components/shell/create-menu";
import { PageHeader } from "@/components/ui/page-header";
import { RouteTabs } from "@/components/ui/route-tabs";
import { getActorCtx } from "@/lib/authz";
import { getCreateMenuData } from "../_shell/data";

export default async function SchedulingLayout({ children }: { children: React.ReactNode }) {
  const createMenu = await getCreateMenuData(await getActorCtx());
  return (
    <>
      <PageHeader title="Scheduling" helpHref="/help" helpLabel="Help with scheduling" actions={<CreateMenu variant="header" align="end" multiHost={createMenu} />} />
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
