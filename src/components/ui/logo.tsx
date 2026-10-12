// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Logo (ARCHITECTURE 20.2): the app mark plus the wordmark from NEXT_PUBLIC_APP_NAME (GEN-01; never Calendly's).
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
};

export function Logo({ variant = "full", href, className }: LogoProps) {
  const content = (
    <span className={cn("inline-flex items-center gap-2 text-title-md text-ink", className)}>
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <circle cx="14" cy="14" r="13" fill="#006bff" />
        <path d="M9 8v12M9 14l7-6M11 13l6 7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      </svg>
      {variant === "full" ? <span>{APP_NAME}</span> : <span className="sr-only">{APP_NAME}</span>}
    </span>
  );
  return href ? (
    <Link href={href} aria-label={`${APP_NAME} home`}>
      {content}
    </Link>
  ) : (
    content
  );
}
