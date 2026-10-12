// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// RouteTabs (ARCHITECTURE 20.2): tabs as links for section layouts (Scheduling, Availability, Admin, Settings). The
// active tab is the one whose href matches the current path (or any sub-path unless exact), with aria-current="page".
"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type * as React from "react";
import { cn } from "@/lib/cn";

export type RouteTab = {
  href: Route;
  label: React.ReactNode;
  /** Only the exact path is active (default: the path or any sub-path). */
  exact?: boolean;
  /** Extra path prefixes that also activate this tab. */
  matchPrefixes?: string[];
  badge?: React.ReactNode;
};

export type RouteTabsProps = {
  tabs: RouteTab[];
  "aria-label": string;
  orientation?: "horizontal" | "vertical";
  className?: string;
};

function isRouteActive(pathname: string, tab: Pick<RouteTab, "href" | "exact" | "matchPrefixes">): boolean {
  const href = String(tab.href).split("?")[0] ?? "";
  if (pathname === href) return true;
  if (!tab.exact && pathname.startsWith(`${href}/`)) return true;
  return (tab.matchPrefixes ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function RouteTabs({ tabs, orientation = "horizontal", className, ...aria }: RouteTabsProps) {
  const pathname = usePathname() ?? "";
  // The most specific active tab wins (a section root tab must not stay active on a sibling tab's path).
  const active = tabs
    .filter((t) => isRouteActive(pathname, t))
    .sort((a, b) => String(b.href).length - String(a.href).length)[0];
  return (
    <nav className={cn(orientation === "vertical" ? "flex flex-col gap-1" : "flex gap-6 border-b border-line", className)} {...aria}>
      {tabs.map((t) => {
        const current = t === active;
        return (
          <Link
            key={String(t.href)}
            href={t.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "text-body-md",
              orientation === "vertical" ? "rounded px-3 py-2" : "-mb-px border-b-2 pb-2",
              current ? "border-primary font-semibold text-ink" : "border-transparent text-ink-2",
            )}
          >
            {t.label}
            {t.badge}
          </Link>
        );
      })}
    </nav>
  );
}
