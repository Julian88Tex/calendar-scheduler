// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// StickyFooterBar (ARCHITECTURE 20.2): the editor footer with Cancel / Save that sticks to the bottom of the viewport.
import type * as React from "react";
import { cn } from "@/lib/cn";

export type StickyFooterBarProps = { children: React.ReactNode; visible?: boolean; className?: string };

export function StickyFooterBar({ children, visible = true, className }: StickyFooterBarProps) {
  if (!visible) return null;
  return <div className={cn("sticky bottom-0 z-10 flex justify-end gap-2 border-t border-line bg-white px-4 py-3", className)}>{children}</div>;
}
