// Coupons and payments.
import type { DbOrTx } from "@/db";
import { coupons, eventTypeCoupons, payments } from "@/db/schema";
import { one, uniq } from "./_util";

export async function createCoupon(
  db: DbOrTx,
  opts: {
    ownerUserId: string;
    code?: string;
    kind?: "percent" | "amount";
    percentOff?: number;
    amountOffMinor?: number;
    currency?: string;
    eventTypeIds?: string[];
  },
) {
  const code = opts.code ?? uniq("SAVE").toUpperCase();
  const kind = opts.kind ?? "percent";
  const coupon = one(
    await db
      .insert(coupons)
      .values({
        ownerUserId: opts.ownerUserId,
        code,
        codeNormalized: code.trim().toLowerCase(),
        name: `Coupon ${code}`,
        kind,
        percentOff: kind === "percent" ? (opts.percentOff ?? 10) : null,
        amountOffMinor: kind === "amount" ? (opts.amountOffMinor ?? 500) : null,
        currency: kind === "amount" ? (opts.currency ?? "USD") : null,
      })
      .returning(),
    "coupon",
  );
  if (opts.eventTypeIds?.length) {
    await db.insert(eventTypeCoupons).values(opts.eventTypeIds.map((eventTypeId) => ({ eventTypeId, couponId: coupon.id })));
  }
  return coupon;
}

export async function createPayment(
  db: DbOrTx,
  opts: {
    organizationId: string;
    inviteeId?: string | null;
    scheduledEventId?: string | null;
    reservationId?: string | null;
    amountMinor?: number;
    currency?: string;
    status?: (typeof payments.$inferInsert)["status"];
  },
) {
  return one(
    await db
      .insert(payments)
      .values({
        organizationId: opts.organizationId,
        inviteeId: opts.inviteeId ?? null,
        scheduledEventId: opts.scheduledEventId ?? null,
        reservationId: opts.reservationId ?? null,
        provider: "stripe",
        externalId: uniq("pi_"),
        amountMinor: opts.amountMinor ?? 5000,
        currency: opts.currency ?? "USD",
        status: opts.status ?? "succeeded",
        paidAt: (opts.status ?? "succeeded") === "succeeded" ? new Date() : null,
      })
      .returning(),
    "payment",
  );
}
