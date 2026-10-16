// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Centered auth card layout (walkthrough 3.2): the logo centered above a white card on the #FAFAFA canvas, the page
// title inside the card, an optional footer line under it. Used by login, two-factor, forgot and reset password and
// verify email. Mobile: the card goes edge to edge with a 16px gutter. Server component.
import type * as React from "react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/cn";

export type AuthShellProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Under the card ("Don't have an account? Sign up for free"). */
  footer?: React.ReactNode;
  /** Optional icon above the title (verify email, two-factor). */
  icon?: React.ReactNode;
  className?: string;
};

export function AuthShell({ title, description, children, footer, icon, className }: AuthShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="flex justify-center px-4 pt-8 pb-6 sm:pt-12">
        <Logo href="/" />
      </header>
      <main id="main" className="flex flex-1 justify-center px-4 pb-16">
        <div className={cn("w-full max-w-[440px]", className)}>
          <div className="rounded-[var(--radius-card)] border border-line bg-white px-5 py-8 shadow-[var(--shadow-card)] sm:px-10 sm:py-10">
            {icon ? <div className="mb-4 flex justify-center">{icon}</div> : null}
            <h1 className="text-center text-headline-3 text-ink">{title}</h1>
            {description ? <p className="mt-2 text-center text-body-md text-ink-2">{description}</p> : null}
            <div className="mt-8">{children}</div>
          </div>
          {footer ? <div className="mt-6 text-center text-body-md text-ink-2">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}

/** Round icon badge used above some auth titles. */
export function AuthIcon({ children, tone = "primary" }: { children: React.ReactNode; tone?: "primary" | "success" | "danger" }) {
  const tones = {
    primary: "bg-primary-soft-2 text-primary-text",
    success: "bg-success-soft text-success-text",
    danger: "bg-danger-soft text-danger-text",
  } as const;
  return (
    <span aria-hidden="true" className={cn("inline-flex size-14 items-center justify-center rounded-full [&_svg]:size-7", tones[tone])}>
      {children}
    </span>
  );
}
