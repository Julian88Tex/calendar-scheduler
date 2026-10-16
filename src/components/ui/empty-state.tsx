// OWNER: foundation-ui.
//
// EmptyState (ARCHITECTURE 20.2, SPEC GEN-12): illustration slot, heading, one sentence and the primary action.
// Server and client safe. Pass `illustration={<Illustration name="calendar-plus" />}` for the classic drawings.
import type * as React from "react";
import { cn } from "@/lib/cn";

export type EmptyStateProps = {
  heading: React.ReactNode;
  body?: React.ReactNode;
  /** Primary action (a Button or a Link styled as one). */
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  illustration?: React.ReactNode;
  icon?: React.ReactNode;
  size?: "sm" | "md";
  className?: string;
  /** Heading level (default 2). */
  headingLevel?: 1 | 2 | 3;
};

export function EmptyState({ heading, body, action, secondaryAction, illustration, icon, size = "md", className, headingLevel = 2 }: EmptyStateProps) {
  const Heading = headingLevel === 1 ? "h1" : headingLevel === 3 ? "h3" : "h2";
  return (
    <div className={cn("flex flex-col items-center text-center", size === "md" ? "gap-3 px-6 py-14" : "gap-2 px-4 py-8", className)}>
      {illustration ?? (icon && <span className="mb-1 inline-flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-text [&_svg]:size-6">{icon}</span>)}
      <Heading className={cn("max-w-lg text-ink", size === "md" ? "text-title-lg" : "text-title-sm")}>{heading}</Heading>
      {body && <p className={cn("max-w-md text-ink-2", size === "md" ? "text-body" : "text-body-md")}>{body}</p>}
      {(action || secondaryAction) && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
