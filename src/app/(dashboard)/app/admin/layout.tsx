// OWNER: foundation-ui.
//
// Admin center section (SPEC ADM-01, GEN-20): owners, admins and instance admins only (others get the 404 page through
// requireAdminCenter). Sub-navigation: Overview, then the organization pages for owners and admins (People, Teams,
// Groups, Managed events, Permissions, Branding, Security and data, Activity log), then the instance pages for
// instance admins (Instance, Outbox, SMS log, Jobs). Becomes a select below 768px.
import type * as React from "react";
import { RouteTabs, type RouteTab } from "@/components/ui/route-tabs";
import { requireAdminCenter } from "@/lib/auth/guards";
import { isOrgAdmin } from "@/lib/authz";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireAdminCenter();
  const org: RouteTab[] = isOrgAdmin(actor)
    ? [
        { href: "/app/admin/people", label: "People", group: "Organization" },
        { href: "/app/admin/teams", label: "Teams", group: "Organization" },
        { href: "/app/admin/groups", label: "Groups", group: "Organization" },
        { href: "/app/admin/managed-events", label: "Managed events", group: "Organization" },
        { href: "/app/admin/permissions", label: "Permissions", group: "Organization" },
        { href: "/app/admin/branding", label: "Branding", group: "Organization" },
        { href: "/app/admin/security", label: "Security and data", group: "Organization" },
        { href: "/app/admin/activity", label: "Activity log", group: "Organization" },
      ]
    : [];
  const instance: RouteTab[] = actor.isInstanceAdmin
    ? [
        { href: "/app/admin/instance", label: "Instance", group: "Instance" },
        { href: "/app/admin/outbox", label: "Outbox", group: "Instance" },
        { href: "/app/admin/sms", label: "SMS log", group: "Instance" },
        { href: "/app/admin/jobs", label: "Jobs", group: "Instance" },
      ]
    : [];
  return (
    <div className="flex min-w-0 flex-col gap-6 md:flex-row md:gap-8">
      <RouteTabs
        aria-label="Admin center"
        orientation="vertical"
        className="md:sticky md:top-4 md:w-56 md:shrink-0 md:self-start"
        tabs={[{ href: "/app/admin", label: "Overview", exact: true }, ...org, ...instance]}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
