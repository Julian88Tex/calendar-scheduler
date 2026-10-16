// OWNER: foundation-ui.
//
// ScrollArea (ARCHITECTURE 20.2): a keyboard-scrollable container (focusable region with an accessible name when
// labelled) with thin, quiet scrollbars. Native scrolling keeps momentum and screen reader behavior intact. Server and
// client safe.
import type * as React from "react";
import { cn } from "@/lib/cn";

export type ScrollAreaProps = {
  children: React.ReactNode;
  maxHeight?: number | string;
  orientation?: "vertical" | "horizontal" | "both";
  className?: string;
  "aria-label"?: string;
};

export function ScrollArea({ children, maxHeight, orientation = "vertical", className, ...aria }: ScrollAreaProps) {
  return (
    <div
      tabIndex={0}
      role={aria["aria-label"] ? "region" : undefined}
      style={{ maxHeight }}
      className={cn(
        "scrollbar-thin min-w-0 overscroll-contain rounded-[inherit] focus-visible:outline-offset-0",
        orientation === "horizontal" ? "overflow-x-auto overflow-y-hidden" : orientation === "both" ? "overflow-auto" : "overflow-x-hidden overflow-y-auto",
        className,
      )}
      {...aria}
    >
      {children}
    </div>
  );
}
