// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// ScrollArea (ARCHITECTURE 20.2): a scroll container with styled scrollbars (Radix ScrollArea in the final version).
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
      style={{ maxHeight }}
      className={cn(orientation === "horizontal" ? "overflow-x-auto" : orientation === "both" ? "overflow-auto" : "overflow-y-auto", className)}
      {...aria}
    >
      {children}
    </div>
  );
}
