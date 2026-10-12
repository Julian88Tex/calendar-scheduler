// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Dashboard navigation (SPEC GEN-20 narrowed by docs/SCOPE.md), in order. Plain data (client and server safe; e2e specs
// iterate it). Icons are lucide names mapped in app-sidebar.tsx. Help is a flyout (HelpMenu), not a link.
//
// docs/SCOPE.md (owner decision) keeps only the areas the owner uses: Scheduling (with the Meeting polls tab, as in
// Calendly), Meetings, Availability and Integrations & apps (Google Calendar). Contacts, Workflows, Routing, Analytics
// and Admin center are not built, so the sidebar shows no entry for them (no links to skipped areas). Account settings
// open from the account menu, as in Calendly's classic sidebar.
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
  { label: "Integrations & apps", href: "/app/integrations", icon: "layout-grid" },
];

/** Bottom group links above Help (none in the reduced scope: Analytics and Admin center are not built). */
export const BOTTOM_NAV: readonly NavItem[] = [];

/** Every nav link (Help excluded), in sidebar order. */
export const ALL_NAV: readonly NavItem[] = [...PRIMARY_NAV, ...BOTTOM_NAV];

/** Active for the item's path and every sub-path (/app/availability/advanced keeps Availability active). */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
