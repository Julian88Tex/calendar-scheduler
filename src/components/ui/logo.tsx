// OWNER: foundation-ui.
//
// Logo (ARCHITECTURE 20.2, SPEC GEN-01): our own geometric "K" mark in brand blue plus the wordmark from
// NEXT_PUBLIC_APP_NAME (never Calendly's logo). "mark" renders the icon only (collapsed sidebar, favicons). Server and
// client safe.
import type { Route } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/cn";

export type LogoProps = {
  /** "full" = mark + name, "mark" = icon only (collapsed sidebar). */
  variant?: "full" | "mark";
  /** Wrap in a link (for example "/app/scheduling"). */
  href?: Route;
  className?: string;
  /** Mark size in px (default 32). */
  size?: number;
};

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={cn("shrink-0", className)}>
      <rect width="32" height="32" rx="9" fill="#006BFF" />
      <path d="M11.5 8.5v15" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M21.5 8.5L14 16l7.5 7.5" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22.4" cy="16" r="2.1" fill="#8CC6FD" />
    </svg>
  );
}

export function Logo({ variant = "full", href, className, size = 32 }: LogoProps) {
  const content = (
    <span className={cn("inline-flex min-w-0 items-center gap-2.5 text-ink", className)}>
      <LogoMark size={size} />
      {variant === "full" ? (
        <span className="truncate text-[20px] leading-none font-bold tracking-[-0.3px]">{APP_NAME}</span>
      ) : (
        <span className="sr-only">{APP_NAME}</span>
      )}
    </span>
  );
  return href ? (
    <Link href={href} aria-label={`${APP_NAME} home`} className="inline-flex min-w-0 rounded-[var(--radius-input)]">
      {content}
    </Link>
  ) : (
    content
  );
}
