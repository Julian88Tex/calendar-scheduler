// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// PageHeader (ARCHITECTURE 20.2): the page title (h1), optional description, actions and help link. Server and client
// safe.
import type { Route } from "next";
import Link from "next/link";
import type * as React from "react";
import { cn } from "@/lib/cn";

export type PageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** "Learn more" style help link. */
  helpHref?: string;
  helpLabel?: string;
  /** Back link above the title (editors, detail pages). */
  back?: { href: Route; label: string };
  badge?: React.ReactNode;
  className?: string;
};

export function PageHeader({ title, description, actions, helpHref, helpLabel = "Learn more", back, badge, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-6 flex flex-col gap-2", className)}>
      {back && (
        <Link href={back.href} className="text-body-md text-primary-text">
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-headline-3">{title}</h1>
          {badge}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {(description || helpHref) && (
        <p className="text-body-md text-ink-2">
          {description}{" "}
          {helpHref && (
            <a href={helpHref} className="text-primary-text underline">
              {helpLabel}
            </a>
          )}
        </p>
      )}
    </header>
  );
}
