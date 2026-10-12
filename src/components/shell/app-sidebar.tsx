// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// AppSidebar (SPEC GEN-20): logo, "+ Create", the nav items in order with the active state (aria-current="page" on the
// item's path and sub-paths), bottom group (Analytics, Admin center for admins, Help flyout), collapse to a 72px rail
// (persisted through onCollapsedChange, a server action writing users.preferences.sidebarCollapsed) and the mobile
// drawer below 768px (foundation-ui). Foundation stub: a plain vertical nav with every item.
"use client";

import { BarChart3, Calendar, Clock, LayoutGrid, Link as LinkIcon, PanelLeftClose, PanelLeftOpen, ShieldCheck, Split, Users, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { Logo } from "../ui/logo";
import { CreateMenu } from "./create-menu";
import { HelpMenu } from "./help-menu";
import { BOTTOM_NAV, isNavActive, PRIMARY_NAV, type NavIcon, type NavItem } from "./nav";

const ICONS: Record<NavIcon, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  link: LinkIcon,
  calendar: Calendar,
  clock: Clock,
  users: Users,
  zap: Zap,
  "layout-grid": LayoutGrid,
  split: Split,
  "bar-chart": BarChart3,
  "shield-check": ShieldCheck,
};

export type AppSidebarProps = {
  /** Owners, admins and instance admins see "Admin center". */
  canSeeAdminCenter: boolean;
  /** users.preferences.sidebarCollapsed. */
  initialCollapsed?: boolean;
  /** Persists the collapsed state (server action). */
  onCollapsedChange?: (collapsed: boolean) => void | Promise<void>;
  /** Instance operator email for Help > Report a problem. */
  operatorEmail?: string | null;
  className?: string;
};

function NavLink({ item, pathname, collapsed }: { item: NavItem; pathname: string; collapsed: boolean }) {
  const Icon = ICONS[item.icon];
  const active = isNavActive(pathname, item.href);
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? item.label : undefined}
        className={cn("flex items-center gap-3 rounded-full px-3 py-2 text-body-md", active ? "bg-primary-soft font-semibold text-primary-text" : "text-ink hover:bg-pebble")}
      >
        <Icon aria-hidden className="size-5 shrink-0" />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    </li>
  );
}

export function AppSidebar({ canSeeAdminCenter, initialCollapsed = false, onCollapsedChange, operatorEmail, className }: AppSidebarProps) {
  const pathname = usePathname() ?? "";
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const bottom = BOTTOM_NAV.filter((i) => !i.adminOnly || canSeeAdminCenter);
  return (
    <aside aria-label="Sidebar" className={cn("flex shrink-0 flex-col gap-4 border-r border-line bg-white p-4", collapsed ? "w-[72px]" : "w-60", className)}>
      <div className="flex items-center justify-between">
        <Logo variant={collapsed ? "mark" : "full"} href="/app/scheduling" />
        <button
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            void onCollapsedChange?.(next);
          }}
          className="rounded-full p-1 text-ink-2 hover:bg-pebble"
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" className="size-4" /> : <PanelLeftClose aria-hidden="true" className="size-4" />}
        </button>
      </div>
      <CreateMenu variant={collapsed ? "compact" : "full"} />
      <nav aria-label="Main" className="flex flex-1 flex-col justify-between gap-4">
        <ul className="flex flex-col gap-1">
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
          ))}
        </ul>
        <ul className="flex flex-col gap-1">
          {bottom.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
          ))}
          <li>
            <HelpMenu operatorEmail={operatorEmail} collapsed={collapsed} />
          </li>
        </ul>
      </nav>
    </aside>
  );
}
