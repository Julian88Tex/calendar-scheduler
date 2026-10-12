// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Kbd (ARCHITECTURE 20.2): a keyboard key.
import type * as React from "react";
import { cn } from "@/lib/cn";

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("rounded border border-line bg-pebble px-1.5 text-body-sm", className)}>{children}</kbd>;
}
