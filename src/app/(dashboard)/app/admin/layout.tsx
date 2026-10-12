// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Admin center section (SPEC ADM-01, GEN-20): owners, admins and instance admins only (others get the 404 page);
// sub-navigation for every admin page (instance-wide pages are shown to instance admins).
import type * as React from "react";
import { RouteTabs, type RouteTab } from "@/components/ui/route-tabs";
import { requireAdminCenter } from "@/lib/auth/guards";
import { isOrgAdmin } from "@/lib/authz";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireAdminCenter();
  const org: RouteTab[] = isOrgAdmin(actor)
    ? [
        { href: "/app/admin/people", label: "People" },
        { href: "/app/admin/teams", label: "Teams" },
        { href: "/app/admin/groups", label: "Groups" },
        { href: "/app/admin/managed-events", label: "Managed events" },
        { href: "/app/admin/permissions", label: "Permissions" },
        { href: "/app/admin/branding", label: "Branding" },
        { href: "/app/admin/security", label: "Security" },
        { href: "/app/admin/activity", label: "Activity log" },
      ]
    : [];
  const instance: RouteTab[] = actor.isInstanceAdmin
    ? [
        { href: "/app/admin/instance", label: "Instance settings" },
        { href: "/app/admin/outbox", label: "Email outbox" },
        { href: "/app/admin/sms", label: "SMS log" },
        { href: "/app/admin/jobs", label: "Jobs" },
      ]
    : [];
  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <RouteTabs
        aria-label="Admin center"
        orientation="vertical"
        className="md:w-56 md:shrink-0"
        tabs={[{ href: "/app/admin", label: "Overview", exact: true }, ...org, ...instance]}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
