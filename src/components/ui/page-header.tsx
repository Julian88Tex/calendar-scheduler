// OWNER: foundation-ui.
//
// PageHeader (ARCHITECTURE 20.2, walkthrough 4.2): the page title (h1, 28px bold #0A2540), optional badge, description,
// a small "?" help link, actions on the right (wrapping under the title on phones) and an optional back link above.
// Server and client safe.
import { ArrowLeft, HelpCircle } from "lucide-react";
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
  const external = helpHref ? /^https?:\/\//.test(helpHref) : false;
  return (
    <header className={cn("mb-6 flex min-w-0 flex-col gap-2", className)}>
      {back && (
        <Link
          href={back.href}
          className="inline-flex w-fit items-center gap-1.5 rounded-full py-1 pr-2 text-[14px] font-semibold text-primary-text hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {back.label}
        </Link>
      )}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 text-[24px] leading-8 font-bold break-words text-ink sm:text-headline-2">{title}</h1>
          {badge}
          {helpHref && (
            <a
              href={helpHref}
              aria-label={helpLabel}
              title={helpLabel}
              {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-primary-soft hover:text-primary-text"
            >
              <HelpCircle aria-hidden="true" className="size-5" />
            </a>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="max-w-3xl text-body-md text-ink-2">{description}</p>}
    </header>
  );
}
