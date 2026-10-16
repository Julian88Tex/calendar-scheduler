// OWNER: payments. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Payment types shared by the event type editor section, the booking payment step and services. Client safe.

export const PAYMENT_CURRENCIES = ["AUD", "CAD", "EUR", "GBP", "USD"] as const;
export type PaymentCurrency = (typeof PAYMENT_CURRENCIES)[number];

/** The payment section of an event type (event_types.payment_* columns plus attached coupons). */
export type PaymentSettings = {
  enabled: boolean;
  provider: "stripe" | "paypal" | null;
  priceMinor: number | null;
  currency: PaymentCurrency | null;
  terms: string | null;
  couponIds: string[];
};

export type BeginPaymentResult =
  | { type: "redirect"; url: string; expiresAt: Date }
  | { type: "popup"; url: string; expiresAt: Date }
  | { type: "inline"; clientSecret: string; publishableKey: string }
  | { type: "free" };
