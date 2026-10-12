// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// EmptyState (ARCHITECTURE 20.2, SPEC GEN-12): illustration slot, heading, body, action. Server and client safe.
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
};

export function EmptyState({ heading, body, action, secondaryAction, illustration, icon, size = "md", className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3 text-center", size === "md" ? "px-6 py-12" : "px-4 py-6", className)}>
      {illustration ?? icon}
      <h2 className={size === "md" ? "text-title-md" : "text-title-sm"}>{heading}</h2>
      {body && <p className="max-w-md text-body-md text-ink-2">{body}</p>}
      {(action || secondaryAction) && (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
