// OWNER: foundation-ui.
//
// StickyFooterBar (ARCHITECTURE 20.2, walkthrough 7.1): the editor footer ("More options", "Cancel", "Save changes")
// that sticks to the bottom of its scroll container with a hairline and a soft upward shadow. Server and client safe.
import type * as React from "react";
import { cn } from "@/lib/cn";

export type StickyFooterBarProps = {
  children: React.ReactNode;
  visible?: boolean;
  className?: string;
  /** Content on the left side ("More options" link, unsaved changes note). */
  start?: React.ReactNode;
};

export function StickyFooterBar({ children, visible = true, className, start }: StickyFooterBarProps) {
  if (!visible) return null;
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-white px-4 py-3 shadow-[0_-1px_6px_0_rgba(10,37,64,0.06)] sm:px-6",
        className,
      )}
    >
      {start && <div className="mr-auto flex min-w-0 items-center gap-2">{start}</div>}
      {children}
    </div>
  );
}
