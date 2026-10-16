// OWNER: foundation-ui.
//
// RouteTabs (ARCHITECTURE 20.2): tabs as links for section layouts (Scheduling, Availability, Admin, Settings). The
// active tab is the one whose href matches the current path (or any sub-path unless exact), with aria-current="page";
// the most specific match wins. Horizontal tabs use the underline style and scroll on narrow screens; vertical tabs are
// a sub-navigation (optional group headings) that becomes a select below 768px (SPEC BR-14).
"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  /** Vertical sub-navigation group heading (consecutive tabs with the same group are listed under it). */
  group?: string;
  /** Plain-text label for the mobile select when `label` is not a string. */
  textLabel?: string;
};

export type RouteTabsProps = {
  tabs: RouteTab[];
  "aria-label": string;
  orientation?: "horizontal" | "vertical";
  className?: string;
  /** Vertical tabs below 768px: "select" (default, BR-14) or "list". */
  mobile?: "select" | "list";
};

export function isRouteActive(pathname: string, tab: Pick<RouteTab, "href" | "exact" | "matchPrefixes">): boolean {
  const href = String(tab.href).split("?")[0] ?? "";
  if (pathname === href) return true;
  if (!tab.exact && pathname.startsWith(`${href}/`)) return true;
  return (tab.matchPrefixes ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The most specific active tab (a section root tab must not stay active on a sibling tab's path). */
export function activeRouteTab<T extends Pick<RouteTab, "href" | "exact" | "matchPrefixes">>(pathname: string, tabs: readonly T[]): T | undefined {
  return tabs.filter((t) => isRouteActive(pathname, t)).sort((a, b) => String(b.href).length - String(a.href).length)[0];
}

const textOf = (t: RouteTab) => t.textLabel ?? (typeof t.label === "string" ? t.label : String(t.href));

export function RouteTabs({ tabs, orientation = "horizontal", className, mobile = "select", ...aria }: RouteTabsProps) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const active = activeRouteTab(pathname, tabs);

  if (orientation === "horizontal") {
    return (
      <nav className={cn("min-w-0 border-b border-line", className)} {...aria}>
        <ul className="-mb-px flex min-w-0 gap-6 overflow-x-auto [scrollbar-width:none]">
          {tabs.map((t) => {
            const current = t === active;
            return (
              <li key={String(t.href)} className="shrink-0">
                <Link
                  href={t.href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-2 border-b-[3px] px-0.5 pt-1 pb-3 text-[14px] font-semibold whitespace-nowrap transition-colors duration-100",
                    current ? "border-primary text-ink" : "border-transparent text-ink-2 hover:text-ink",
                  )}
                >
                  {t.label}
                  {t.badge}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  // Vertical: group consecutive tabs by heading.
  const sections: { group: string | undefined; tabs: RouteTab[] }[] = [];
  for (const t of tabs) {
    const last = sections[sections.length - 1];
    if (last && last.group === t.group) last.tabs.push(t);
    else sections.push({ group: t.group, tabs: [t] });
  }

  return (
    <nav className={cn("min-w-0", className)} {...aria}>
      {mobile === "select" && (
        <div className="relative md:hidden">
          <select
            aria-label={aria["aria-label"]}
            value={active ? String(active.href) : ""}
            onChange={(e) => router.push(e.target.value as Route)}
            className="h-10 w-full appearance-none rounded-[var(--radius-input)] border border-line bg-white pr-9 pl-3 text-[16px] font-semibold text-ink"
          >
            {!active && <option value="">{aria["aria-label"]}</option>}
            {sections.map((s, i) =>
              s.group ? (
                <optgroup key={`${s.group}-${i}`} label={s.group}>
                  {s.tabs.map((t) => (
                    <option key={String(t.href)} value={String(t.href)}>
                      {textOf(t)}
                    </option>
                  ))}
                </optgroup>
              ) : (
                s.tabs.map((t) => (
                  <option key={String(t.href)} value={String(t.href)}>
                    {textOf(t)}
                  </option>
                ))
              ),
            )}
          </select>
          <svg aria-hidden="true" viewBox="0 0 16 16" className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-2">
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      <div className={cn("flex flex-col gap-4", mobile === "select" && "max-md:hidden")}>
        {sections.map((s, i) => (
          <div key={`${s.group ?? "none"}-${i}`} className="flex flex-col gap-0.5">
            {s.group && <p className="px-3 pb-1 text-eyebrow text-ink-2">{s.group}</p>}
            <ul className="flex flex-col gap-0.5">
              {s.tabs.map((t) => {
                const current = t === active;
                return (
                  <li key={String(t.href)}>
                    <Link
                      href={t.href}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "flex min-h-10 items-center gap-2 rounded-full px-3 py-2 text-[14px] transition-colors duration-100",
                        current ? "bg-primary-soft font-semibold text-primary-text" : "text-ink hover:bg-pebble",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{t.label}</span>
                      {t.badge}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
