// OWNER: foundation-ui.
//
// Illustration: small flat line drawings for empty states (SPEC GEN-12, ET-33 "calendar with a plus"), drawn in the
// theme tokens so they follow dark mode. Decorative (aria-hidden). Server and client safe.
import type * as React from "react";
import { cn } from "@/lib/cn";

export type IllustrationName =
  | "calendar-plus"
  | "calendar"
  | "clock"
  | "link"
  | "users"
  | "workflow"
  | "routing"
  | "chart"
  | "search"
  | "inbox"
  | "poll"
  | "integrations"
  | "not-found"
  | "error";

export type IllustrationProps = { name: IllustrationName; size?: number; className?: string };

function Frame({ size, className, children }: { size: number; className?: string; children: React.ReactNode }) {
  return (
    <svg width={size} height={size * 0.75} viewBox="0 0 160 120" aria-hidden="true" focusable="false" className={cn("shrink-0", className)}>
      <ellipse cx="80" cy="64" rx="64" ry="50" className="fill-primary-soft" />
      {children}
    </svg>
  );
}

function CalendarBase({ plus }: { plus?: boolean }) {
  return (
    <>
      <rect x="44" y="30" width="72" height="62" rx="8" className="fill-surface stroke-line-medium" strokeWidth="2" />
      <path d="M44 38a8 8 0 0 1 8-8h56a8 8 0 0 1 8 8v8H44z" className="fill-primary" />
      <rect x="58" y="24" width="4" height="12" rx="2" className="fill-ink-2" />
      <rect x="98" y="24" width="4" height="12" rx="2" className="fill-ink-2" />
      {[0, 1, 2, 3].map((c) =>
        [0, 1, 2].map((r) => <rect key={`${c}-${r}`} x={54 + c * 14} y={54 + r * 11} width="8" height="6" rx="2" className="fill-mist" />),
      )}
      {plus && (
        <>
          <circle cx="114" cy="88" r="15" className="fill-primary" />
          <path d="M114 81v14M107 88h14" className="stroke-white" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
    </>
  );
}

export function Illustration({ name, size = 160, className }: IllustrationProps) {
  switch (name) {
    case "calendar-plus":
      return (
        <Frame size={size} className={className}>
          <CalendarBase plus />
        </Frame>
      );
    case "calendar":
      return (
        <Frame size={size} className={className}>
          <CalendarBase />
          <rect x="68" y="65" width="8" height="6" rx="2" className="fill-primary" />
        </Frame>
      );
    case "clock":
      return (
        <Frame size={size} className={className}>
          <circle cx="80" cy="62" r="32" className="fill-surface stroke-line-medium" strokeWidth="2" />
          <path d="M80 42v20l14 9" className="stroke-primary" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <circle cx="80" cy="62" r="3" className="fill-primary" />
        </Frame>
      );
    case "link":
      return (
        <Frame size={size} className={className}>
          <rect x="34" y="50" width="52" height="24" rx="12" className="fill-none stroke-primary" strokeWidth="5" />
          <rect x="74" y="50" width="52" height="24" rx="12" className="fill-none stroke-ink-2" strokeWidth="5" />
        </Frame>
      );
    case "users":
      return (
        <Frame size={size} className={className}>
          <circle cx="66" cy="50" r="13" className="fill-surface stroke-ink-2" strokeWidth="2.5" />
          <path d="M42 88c2-14 12-22 24-22s22 8 24 22" className="fill-surface stroke-ink-2" strokeWidth="2.5" />
          <circle cx="98" cy="54" r="11" className="fill-primary-soft-2 stroke-primary" strokeWidth="2.5" />
          <path d="M80 88c2-12 9-18 18-18s16 6 18 18" className="fill-primary-soft-2 stroke-primary" strokeWidth="2.5" />
        </Frame>
      );
    case "workflow":
      return (
        <Frame size={size} className={className}>
          <rect x="40" y="32" width="44" height="22" rx="6" className="fill-surface stroke-line-medium" strokeWidth="2" />
          <rect x="76" y="70" width="44" height="22" rx="6" className="fill-surface stroke-line-medium" strokeWidth="2" />
          <path d="M62 54v10a6 6 0 0 0 6 6h8" className="stroke-ink-2" strokeWidth="2.5" fill="none" />
          <path d="M92 40l-8 14h9l-6 14 14-18h-9l6-10z" className="fill-primary" />
        </Frame>
      );
    case "routing":
      return (
        <Frame size={size} className={className}>
          <path d="M44 62h28l18-22h26M72 62l18 22h26" className="stroke-ink-2" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="44" cy="62" r="8" className="fill-primary" />
          <circle cx="116" cy="40" r="7" className="fill-surface stroke-primary" strokeWidth="3" />
          <circle cx="116" cy="84" r="7" className="fill-surface stroke-primary" strokeWidth="3" />
        </Frame>
      );
    case "chart":
      return (
        <Frame size={size} className={className}>
          <rect x="44" y="30" width="72" height="62" rx="8" className="fill-surface stroke-line-medium" strokeWidth="2" />
          <rect x="56" y="64" width="10" height="18" rx="2" className="fill-mist" />
          <rect x="72" y="50" width="10" height="32" rx="2" className="fill-primary" />
          <rect x="88" y="58" width="10" height="24" rx="2" className="fill-ink-3" />
        </Frame>
      );
    case "search":
      return (
        <Frame size={size} className={className}>
          <circle cx="74" cy="58" r="22" className="fill-surface stroke-ink-2" strokeWidth="5" />
          <path d="M90 74l18 18" className="stroke-ink-2" strokeWidth="7" strokeLinecap="round" />
        </Frame>
      );
    case "inbox":
      return (
        <Frame size={size} className={className}>
          <path d="M42 64l12-28h52l12 28v24a6 6 0 0 1-6 6H48a6 6 0 0 1-6-6z" className="fill-surface stroke-line-medium" strokeWidth="2" />
          <path d="M42 64h24l4 8h20l4-8h24" className="stroke-primary" strokeWidth="3" fill="none" strokeLinejoin="round" />
        </Frame>
      );
    case "poll":
      return (
        <Frame size={size} className={className}>
          <rect x="44" y="30" width="72" height="62" rx="8" className="fill-surface stroke-line-medium" strokeWidth="2" />
          <rect x="56" y="44" width="48" height="8" rx="4" className="fill-primary" />
          <rect x="56" y="58" width="34" height="8" rx="4" className="fill-mist" />
          <rect x="56" y="72" width="24" height="8" rx="4" className="fill-mist" />
        </Frame>
      );
    case "integrations":
      return (
        <Frame size={size} className={className}>
          <rect x="46" y="32" width="28" height="28" rx="6" className="fill-primary" />
          <rect x="86" y="32" width="28" height="28" rx="6" className="fill-surface stroke-line-medium" strokeWidth="2" />
          <rect x="46" y="68" width="28" height="28" rx="6" className="fill-surface stroke-line-medium" strokeWidth="2" />
          <rect x="86" y="68" width="28" height="28" rx="6" className="fill-primary-soft-2 stroke-primary" strokeWidth="2" />
        </Frame>
      );
    case "not-found":
      return (
        <Frame size={size} className={className}>
          <rect x="44" y="30" width="72" height="62" rx="8" className="fill-surface stroke-line-medium" strokeWidth="2" />
          <path d="M68 52l24 24M92 52L68 76" className="stroke-ink-2" strokeWidth="5" strokeLinecap="round" />
        </Frame>
      );
    case "error":
      return (
        <Frame size={size} className={className}>
          <path d="M80 30l40 64H40z" className="fill-surface stroke-line-medium" strokeWidth="2" strokeLinejoin="round" />
          <path d="M80 52v20" className="stroke-danger" strokeWidth="6" strokeLinecap="round" />
          <circle cx="80" cy="83" r="3.5" className="fill-danger" />
        </Frame>
      );
  }
}
