// OWNER: payments. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// EventTypePaymentSection (SPEC PAY-01): payment toggle, processor, amount, currency, terms and coupons in the event
// type editor. Foundation stub: "Connect Stripe to collect payments".
"use client";

import type { PaymentSettings } from "@/lib/payments/types";

export type EventTypePaymentSectionProps = {
  value: PaymentSettings;
  onChange: (value: PaymentSettings) => void;
  /** null for an unsaved event type. */
  eventTypeId: string | null;
  disabled?: boolean;
};

export function EventTypePaymentSection(_props: EventTypePaymentSectionProps) {
  return <p className="text-body-md text-ink-2">Connect Stripe to collect payments.</p>;
}
