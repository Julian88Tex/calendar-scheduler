// Troubleshoot reason chips (docs/SCOPE.md priority 4; SPEC SCH-21, Appendix B): the short uppercase label of every
// reason code, written as words like the others ("DAILY MAX", "MEETING LIMIT", "TOO SOON", "ROUND ROBIN"; never a
// bare code such as "TOOSOON"), and the dashed chip that shows a label next to a start time. Server and client safe
// (no hooks).
import type * as React from "react";
import { cn } from "@/lib/cn";
import type { ReasonCode } from "@/lib/slots/types";

/** The chip label of each reason code. */
export const REASON_CHIP_LABELS: Readonly<Record<ReasonCode, string>> = {
  CALENDAR: "CALENDAR",
  NOCAL: "NO CALENDAR",
  DAILY_MAX: "DAILY MAX",
  WEEKLY_MAX: "WEEKLY MAX",
  MONTHLY_MAX: "MONTHLY MAX",
  DURATION: "DURATION",
  RANGE: "RANGE",
  TOOSOON: "TOO SOON",
  EVENT: "EVENT",
  GROUP: "GROUP",
  OVERLAP: "OVERLAP",
  HOLIDAY: "HOLIDAY",
  MEETING_LIMIT: "MEETING LIMIT",
  HOST: "HOST",
  ROUNDROBIN: "ROUND ROBIN",
  UNFAIR: "UNFAIR",
  BUFFER: "BUFFER",
  PAST: "PAST",
  RESERVED: "RESERVED",
};

/** The chip label of a reason code; an unknown code reads with spaces instead of underscores. */
export function reasonChipLabel(code: string): string {
  return Object.hasOwn(REASON_CHIP_LABELS, code) ? REASON_CHIP_LABELS[code as ReasonCode] : code.replace(/_+/g, " ").trim();
}

export type ReasonChipProps = {
  children: React.ReactNode;
  /** "blocked": a reason code (dark text on the pebble fill); "outside": outside working hours (muted). */
  tone?: "blocked" | "outside";
  className?: string;
};

/** The dashed uppercase chip of an unavailable start time. */
export function ReasonChip({ children, tone = "blocked", className }: ReasonChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-dashed px-2 py-0.5 text-[11px] leading-4 font-bold tracking-[0.04em] uppercase",
        tone === "outside" ? "border-line-medium text-ink-2" : "border-ink-3 bg-pebble text-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}
