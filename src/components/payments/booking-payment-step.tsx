// OWNER: payments. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// BookingPaymentStep (SPEC PAY-02, PAY-03, BK-32): Stripe Payment Element with the hold countdown, or the Checkout
// redirect (popup in embed mode). Foundation stub: a notice.
"use client";

export type BookingPaymentStepProps = {
  reservationId: string;
  amountMinor: number;
  currency: string;
  terms: string | null;
  embed: boolean;
  /** Called with the new invitee id once the booking is completed. */
  onComplete: (inviteeId: string) => void;
};

export function BookingPaymentStep(_props: BookingPaymentStepProps) {
  return <p className="text-body-md text-ink-2">Payments are not available yet.</p>;
}
