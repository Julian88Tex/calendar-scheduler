// Building blocks of the booking "Enter Details" form, shared with the reschedule form (SPEC BK-09, BK-12; live capture
// docs/research/calendly-live-capture.md items 7, 8, 12, 13 and 18): bold 14px labels with a small dark asterisk after
// a space, 40px fields with a #A6BBD1 border and a 2px --primary-color border on focus (red while invalid), the inline
// error, the terms sentence (always shown, linking the configured Terms and Privacy URLs or /terms and /privacy) and the
// 40px "Schedule Event" pill. Client safe.
"use client";

import type * as React from "react";
import { legalLinkHref } from "@/components/public/public-footer-links";
import { cn } from "@/lib/cn";
import { bt } from "./lib/t";

export { BookingFieldError } from "./field-error";

/** Field labels: 14px bold navy. */
export const FIELD_LABEL = "text-[14px] leading-5 font-bold text-ink";

/**
 * Classes for Input, Textarea and the guests box: the #A6BBD1 resting border, and on focus a 2px border in the page's
 * --primary-color (1px border plus a 1px ring) instead of the app's offset outline; invalid fields keep a red border.
 */
export const BOOKING_FIELD =
  "border-line-medium focus:border-brand focus:shadow-[0_0_0_1px_var(--primary-color)] focus-visible:outline-none " +
  "aria-[invalid=true]:focus:border-danger aria-[invalid=true]:focus:shadow-[0_0_0_1px_var(--danger)]";

/** The same focus treatment for a composite field box (focus-within). */
export const BOOKING_FIELD_BOX =
  "border-line-medium focus-within:border-brand focus-within:shadow-[0_0_0_1px_var(--primary-color)] focus-within:outline-none";

/** The public pages' primary pill: every blue reads --primary-color (GEN-03). */
export const BRAND_BUTTON = "bg-brand text-white hover:bg-brand hover:brightness-90 active:bg-brand active:brightness-75";

/** The decorative required asterisk ("Name *"): small, dark gray, raised, after a space. */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="relative -top-[3px] ml-1 text-[11px] leading-none font-normal text-ink-2">
      *
    </span>
  );
}

const TERMS = "%%terms%%";
const PRIVACY = "%%privacy%%";

function LegalLink({ href, children }: { href: string; children: React.ReactNode }) {
  const external = /^https?:\/\//.test(href);
  return (
    <a href={href} className="font-bold text-brand hover:underline" {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </a>
  );
}

/**
 * "By proceeding, you confirm that you have read and agree to {AppName}'s Participant Terms and Privacy Notice." (BK-09):
 * 14px navy with both names as bold blue links, like Calendly's line above the button.
 */
export function BookingLegalNotice({ appName, termsUrl, privacyUrl, className }: { appName: string; termsUrl: string | null; privacyUrl: string | null; className?: string }) {
  const parts = bt("details.termsNotice", { terms: TERMS, privacy: PRIVACY }).split(/(%%terms%%|%%privacy%%)/);
  return (
    <p className={cn("text-[14px] leading-[21px] text-public-text", className)} data-testid="legal-notice">
      {parts.map((part, i) =>
        part === TERMS ? (
          <LegalLink key={i} href={legalLinkHref(termsUrl, "/terms")}>
            {bt("details.termsLink", { appName })}
          </LegalLink>
        ) : part === PRIVACY ? (
          <LegalLink key={i} href={legalLinkHref(privacyUrl, "/privacy")}>
            {bt("details.privacyNotice")}
          </LegalLink>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}
