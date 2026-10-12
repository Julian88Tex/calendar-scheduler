// OWNER: foundation-ui.
//
// AppSidebar (SPEC GEN-20, GEN-04, walkthrough 4.1, docs/SCOPE.md): the 240px white sidebar with a #D4E0ED right
// border: logo, collapse button, the full-width "+ Create" pill, the nav items in order (Scheduling, Meetings,
// Availability, Integrations & apps; the areas docs/SCOPE.md skips get no entry) and the bottom group with the Help
// flyout. The active item (its path or any sub-path) is a #F4F8FF pill with #004EBA text and icon and
// aria-current="page". Collapsing shrinks it to a 72px icon rail with tooltips and a "+" create button; the state
// persists through onCollapsedChange (users.preferences.sidebarCollapsed). Below 768px the sidebar is a drawer (focus
// trap, Escape and scrim close, closes on navigation) opened from AppHeader's 56px top bar.
"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { BarChart3, Calendar, ChevronsLeft, ChevronsRight, Clock, LayoutGrid, Link as LinkIcon, ShieldCheck, Split, Users, X, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { OVERLAY_CLASS } from "../ui/dialog";
import { Logo } from "../ui/logo";
import { toast } from "../ui/toast";
import { Tooltip } from "../ui/tooltip";
import { useReturnFocus } from "../ui/use-return-focus";
import { CreateMenu, type CreateMenuMultiHost } from "./create-menu";
import { HelpMenu } from "./help-menu";
import { setMobileNavOpen, useMobileNavOpen } from "./mobile-nav";
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
  onCollapsedChange?: (collapsed: boolean) => unknown;
  /** Instance operator email for Help > Report a problem. */
  operatorEmail?: string | null;
  className?: string;
  /** Kept for compatibility: multi-host event types are out of scope (docs/SCOPE.md), so the Create menu ignores it. */
  createMenu?: CreateMenuMultiHost;
};

function NavLink({ item, pathname, collapsed, onNavigate }: { item: NavItem; pathname: string; collapsed: boolean; onNavigate?: () => void }) {
  const Icon = ICONS[item.icon];
  const active = isNavActive(pathname, item.href);
  const link = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      onClick={onNavigate}
      className={cn(
        "flex h-10 items-center gap-3 rounded-full text-[14px] font-semibold transition-colors duration-100",
        collapsed ? "w-10 justify-center self-center" : "px-3",
        active ? "bg-primary-soft text-primary-text" : "text-ink hover:bg-pebble",
      )}
    >
      <Icon aria-hidden className={cn("size-5 shrink-0", active ? "text-primary-text" : "text-ink-2")} />
      {!collapsed && <span className="min-w-0 truncate">{item.label}</span>}
    </Link>
  );
  return (
    <li className={cn("flex flex-col", collapsed && "items-center")}>
      {collapsed ? (
        <Tooltip content={item.label} side="right">
          {link}
        </Tooltip>
      ) : (
        link
      )}
    </li>
  );
}

function SidebarBody({
  collapsed,
  pathname,
  canSeeAdminCenter,
  operatorEmail,
  onNavigate,
  header,
}: {
  collapsed: boolean;
  pathname: string;
  canSeeAdminCenter: boolean;
  operatorEmail?: string | null;
  onNavigate?: () => void;
  header: React.ReactNode;
}) {
  const bottom = BOTTOM_NAV.filter((i) => !i.adminOnly || canSeeAdminCenter);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className={cn("px-4 pb-4", collapsed && "flex justify-center px-0")}>
        <CreateMenu variant={collapsed ? "compact" : "full"} />
      </div>
      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col justify-between gap-4 overflow-y-auto overflow-x-hidden px-3 pb-4 [scrollbar-width:thin]">
        <ul className="flex flex-col gap-1">
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </ul>
        <ul className="flex flex-col gap-1 border-t border-line pt-4">
          {bottom.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
          <li className={cn("flex flex-col", collapsed && "items-center")}>
            <HelpMenu operatorEmail={operatorEmail} collapsed={collapsed} />
          </li>
        </ul>
      </nav>
    </div>
  );
}

export function AppSidebar({ canSeeAdminCenter, initialCollapsed = false, onCollapsedChange, operatorEmail, className }: AppSidebarProps) {
  const pathname = usePathname() ?? "";
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [, startTransition] = useTransition();
  const mobileOpen = useMobileNavOpen();
  const returnFocus = useReturnFocus();

  // Close the drawer after navigation.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    startTransition(async () => {
      try {
        const result = (await onCollapsedChange?.(next)) as { ok?: boolean } | undefined;
        if (result && result.ok === false) throw new Error("not saved");
      } catch {
        toast.error("Couldn't save the sidebar setting.");
      }
    });
  };

  return (
    <>
      <aside
        aria-label="Sidebar"
        data-collapsed={collapsed || undefined}
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-white transition-[width] duration-200 ease-out md:flex",
          collapsed ? "w-[72px]" : "w-60",
          className,
        )}
      >
        <SidebarBody
          collapsed={collapsed}
          pathname={pathname}
          canSeeAdminCenter={canSeeAdminCenter}
          operatorEmail={operatorEmail}
          header={
            <div className={cn("flex h-16 shrink-0 items-center gap-2", collapsed ? "flex-col justify-center gap-1 py-3 h-auto" : "justify-between pr-2 pl-5")}>
              <Logo variant={collapsed ? "mark" : "full"} href="/app/scheduling" size={collapsed ? 28 : 30} />
              <Tooltip content={collapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
                <button
                  type="button"
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  aria-expanded={!collapsed}
                  onClick={toggle}
                  className="inline-flex size-8 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-primary-soft hover:text-primary-text"
                >
                  {collapsed ? <ChevronsRight aria-hidden="true" className="size-4" /> : <ChevronsLeft aria-hidden="true" className="size-4" />}
                </button>
              </Tooltip>
            </div>
          }
        />
      </aside>
      <RadixDialog.Root open={mobileOpen} onOpenChange={setMobileNavOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className={cn(OVERLAY_CLASS, "md:hidden")} />
          <RadixDialog.Content
            {...returnFocus}
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex w-[min(300px,85vw)] flex-col bg-white shadow-[var(--shadow-pop)] outline-none data-[state=open]:animate-sheet-in-left md:hidden"
          >
            <RadixDialog.Title className="sr-only">Navigation</RadixDialog.Title>
            <SidebarBody
              collapsed={false}
              pathname={pathname}
              canSeeAdminCenter={canSeeAdminCenter}
              operatorEmail={operatorEmail}
              onNavigate={() => setMobileNavOpen(false)}
              header={
                <div className="flex h-14 shrink-0 items-center justify-between pr-2 pl-4">
                  <Logo variant="full" href="/app/scheduling" size={28} />
                  <RadixDialog.Close
                    aria-label="Close navigation"
                    className="inline-flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-primary-soft hover:text-primary-text"
                  >
                    <X aria-hidden="true" className="size-5" />
                  </RadixDialog.Close>
                </div>
              }
            />
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    </>
  );
}
