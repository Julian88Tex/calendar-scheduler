// OWNER: payments. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Payments contract (ARCHITECTURE section 25, SPEC PAY-01..PAY-10): configuration check, starting a payment for a
// booking-core reservation and the payment of an invitee. Foundation stub: not configured, begin throws, no payment.
import "server-only";
import type { payments } from "@/db/schema";
import { AppError } from "@/lib/errors";
import type { BeginPaymentResult } from "./types";

export { PAYMENT_CURRENCIES, type BeginPaymentResult, type PaymentCurrency, type PaymentSettings } from "./types";

export type PaymentRow = typeof payments.$inferSelect;

/** True when a payment provider is configured (STRIPE_SECRET_KEY). Stub: false. */
export function isPaymentsConfigured(): boolean {
  return false;
}

/**
 * Starts the payment of a pending reservation: inline Payment Element (publishable key set), Stripe Checkout redirect,
 * a popup in embed mode (Checkout cannot be framed), or "free" when a coupon covers the price.
 */
export async function beginPayment(p: { reservationId: string; returnUrl: string; embed: boolean; couponCode?: string | null }): Promise<BeginPaymentResult> {
  void p;
  throw new AppError("not_configured", "Payments are not configured on this server.");
}

/** The payment attached to an invitee (moved to the new invitee on reschedule), or null. */
export async function getPaymentForInvitee(inviteeId: string): Promise<PaymentRow | null> {
  void inviteeId;
  return null;
}
