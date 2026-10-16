// OWNER: foundation-ui.
//
// Kbd (ARCHITECTURE 20.2): a keyboard key. Server and client safe.
import type * as React from "react";
import { cn } from "@/lib/cn";

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-line border-b-2 bg-cloud px-1.5 font-sans text-[11px] leading-none font-semibold text-ink-2",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
