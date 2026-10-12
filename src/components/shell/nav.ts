// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Dashboard navigation (SPEC GEN-20), in order. Plain data (client and server safe; e2e specs iterate it). Icons are
// lucide names mapped in app-sidebar.tsx. Help is a flyout (HelpMenu), not a link.
import type { Route } from "next";

export type NavIcon = "link" | "calendar" | "clock" | "users" | "zap" | "layout-grid" | "split" | "bar-chart" | "shield-check";

export type NavItem = {
  label: string;
  href: Route;
  icon: NavIcon;
  /** Only owners, admins and instance admins see it. */
  adminOnly?: boolean;
};

export const PRIMARY_NAV: readonly NavItem[] = [
  { label: "Scheduling", href: "/app/scheduling", icon: "link" },
  { label: "Meetings", href: "/app/meetings", icon: "calendar" },
  { label: "Availability", href: "/app/availability", icon: "clock" },
  { label: "Contacts", href: "/app/contacts", icon: "users" },
  { label: "Workflows", href: "/app/workflows", icon: "zap" },
  { label: "Integrations & apps", href: "/app/integrations", icon: "layout-grid" },
  { label: "Routing", href: "/app/routing", icon: "split" },
];

export const BOTTOM_NAV: readonly NavItem[] = [
  { label: "Analytics", href: "/app/analytics", icon: "bar-chart" },
  { label: "Admin center", href: "/app/admin", icon: "shield-check", adminOnly: true },
];

/** Every nav link (Help excluded), in sidebar order. */
export const ALL_NAV: readonly NavItem[] = [...PRIMARY_NAV, ...BOTTOM_NAV];

/** Active for the item's path and every sub-path (/app/workflows/new keeps Workflows active). */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
