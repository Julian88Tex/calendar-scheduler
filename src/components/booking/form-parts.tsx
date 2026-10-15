// Building blocks of the booking "Enter Details" form, shared with the reschedule form (SPEC BK-09, BK-12; live capture
// docs/research/calendly-live-capture.md items 7, 8, 12, 13 and 18): 14px semibold labels with a small dark asterisk
// after a space, 40px fields with a #A6BBD1 border and a 2px --primary-color border on focus drawn inside the box (red
// while invalid), the inline error, the terms sentence (always shown, linking the configured Terms and Privacy URLs or
// /terms and /privacy; the closing period belongs to the last link, as on Calendly) and the 40px "Schedule Event" pill.
// Client safe.
"use client";

import type * as React from "react";
import { legalLinkHref } from "@/components/public/public-footer-links";
import { cn } from "@/lib/cn";
import { bt } from "./lib/t";

export { BookingFieldError } from "./field-error";

/**
 * Field labels: 14px semibold navy (Figtree's bold reads heavier and wider than Calendly's labels), drawn 2px above
 * their line box so the glyphs sit where Calendly's do while the fields keep their place.
 */
export const FIELD_LABEL = "relative -top-0.5 text-[14px] leading-5 font-semibold text-ink";

/**
 * Classes for Input, Textarea and the guests box: the #A6BBD1 resting border, and on focus a 2px border in the page's
 * --primary-color (1px border plus a 1px inset ring, so the box keeps its size) instead of the app's offset outline;
 * invalid fields keep a red border.
 */
export const BOOKING_FIELD =
  "border-line-medium focus:border-brand focus:shadow-[inset_0_0_0_1px_var(--primary-color)] focus-visible:outline-none " +
  "aria-[invalid=true]:focus:border-danger aria-[invalid=true]:focus:shadow-[inset_0_0_0_1px_var(--danger)]";

/** The same focus treatment for a composite field box (focus-within). */
export const BOOKING_FIELD_BOX =
  "border-line-medium focus-within:border-brand focus-within:shadow-[inset_0_0_0_1px_var(--primary-color)] focus-within:outline-none";

/** The public pages' primary pill: every blue reads --primary-color (GEN-03). */
export const BRAND_BUTTON = "bg-brand text-white hover:bg-brand hover:brightness-90 active:bg-brand active:brightness-75";

/** The decorative required asterisk ("Name *"): small, navy, its top level with the label's capitals, after a space. */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="relative -top-px ml-1 text-[11px] leading-none font-normal text-ink">
      *
    </span>
  );
}

const TERMS = "%%terms%%";
const PRIVACY = "%%privacy%%";

/** Bold blue links that stay as they are under the pointer, like Calendly's (no hover underline). */
function LegalLink({ href, children }: { href: string; children: React.ReactNode }) {
  const external = /^https?:\/\//.test(href);
  return (
    <a href={href} className="font-bold text-brand" {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </a>
  );
}

export type LegalNoticePart = { kind: "text" | "terms" | "privacy"; text: string; trailing: string };

/**
 * Splits the terms sentence around its two link placeholders. Punctuation that directly follows a link and ends the
 * sentence ("... and {privacy}.") joins that link, as Calendly draws "Privacy Notice." as one bold blue link.
 */
export function legalNoticeParts(sentence: string): LegalNoticePart[] {
  const raw = sentence.split(/(%%terms%%|%%privacy%%)/).filter((part) => part !== "");
  const out: LegalNoticePart[] = [];
  for (let i = 0; i < raw.length; i++) {
    const part = raw[i]!;
    if (part === TERMS || part === PRIVACY) {
      const next = raw[i + 1];
      const trailing = i + 2 === raw.length && next !== undefined && /^[.!?]$/.test(next) ? next : "";
      if (trailing) i++;
      out.push({ kind: part === TERMS ? "terms" : "privacy", text: "", trailing });
    } else {
      out.push({ kind: "text", text: part, trailing: "" });
    }
  }
  return out;
}

/**
 * "By proceeding, you confirm that you have read and agree to {AppName}'s Participant Terms and Privacy Notice." (BK-09):
 * 14px navy with both names as bold blue links (the final period inside the last one), like Calendly's line above the
 * button.
 */
export function BookingLegalNotice({ appName, termsUrl, privacyUrl, className }: { appName: string; termsUrl: string | null; privacyUrl: string | null; className?: string }) {
  const parts = legalNoticeParts(bt("details.termsNotice", { terms: TERMS, privacy: PRIVACY }));
  return (
    <p className={cn("text-[14px] leading-[21px] text-public-text", className)} data-testid="legal-notice">
      {parts.map((part, i) =>
        part.kind === "terms" ? (
          <LegalLink key={i} href={legalLinkHref(termsUrl, "/terms")}>
            {`${bt("details.termsLink", { appName })}${part.trailing}`}
          </LegalLink>
        ) : part.kind === "privacy" ? (
          <LegalLink key={i} href={legalLinkHref(privacyUrl, "/privacy")}>
            {`${bt("details.privacyNotice")}${part.trailing}`}
          </LegalLink>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}
