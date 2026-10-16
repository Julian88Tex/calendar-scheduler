// ARCHITECTURE section 5.4.18: payments, coupons, event type coupon links and redemptions.
import { relations, sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, deletedAt, pk, ts, updatedAt } from "./_columns.ts";
import { paymentProvider } from "./_enums.ts";
import { users } from "./auth.ts";
import { eventTypes } from "./event-types.ts";
import { bookingReservations, invitees, scheduledEvents } from "./bookings.ts";

export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "succeeded",
  "failed",
  "refunded",
  "partially_refunded",
  "canceled",
]);
export const couponKind = pgEnum("coupon_kind", ["percent", "amount"]);

export const payments = pgTable(
  "payments",
  {
    id: pk(),
    organizationId: uuid("organization_id").notNull(),
    inviteeId: uuid("invitee_id").references((): AnyPgColumn => invitees.id, { onDelete: "set null" }),
    scheduledEventId: uuid("scheduled_event_id").references((): AnyPgColumn => scheduledEvents.id, { onDelete: "set null" }),
    reservationId: uuid("reservation_id").references((): AnyPgColumn => bookingReservations.id, { onDelete: "set null" }),
    provider: paymentProvider("provider").notNull(),
    externalId: text("external_id").notNull(), // PaymentIntent, Checkout Session or PayPal order id
    externalChargeId: text("external_charge_id"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    discountMinor: integer("discount_minor").notNull().default(0),
    couponId: uuid("coupon_id").references((): AnyPgColumn => coupons.id, { onDelete: "set null" }),
    status: paymentStatus("status").notNull().default("pending"),
    termsSnapshot: text("terms_snapshot"),
    receiptUrl: text("receipt_url"),
    refundedMinor: integer("refunded_minor").notNull().default(0),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    paidAt: ts("paid_at"),
    refundedAt: ts("refunded_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payments_external_uq").on(t.provider, t.externalId),
    index("payments_invitee_idx").on(t.inviteeId),
    index("payments_scheduled_event_idx").on(t.scheduledEventId),
    index("payments_reservation_idx").on(t.reservationId),
    index("payments_coupon_idx").on(t.couponId),
  ],
);

export const coupons = pgTable(
  "coupons",
  {
    id: pk(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    codeNormalized: text("code_normalized").notNull(),
    name: text("name").notNull(),
    kind: couponKind("kind").notNull(),
    percentOff: integer("percent_off"),
    amountOffMinor: integer("amount_off_minor"),
    currency: text("currency"),
    firstTimeOnly: boolean("first_time_only").notNull().default(false),
    maxRedemptions: integer("max_redemptions"),
    redeemedCount: integer("redeemed_count").notNull().default(0),
    expiresAt: ts("expires_at"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("coupons_code_uq").on(t.ownerUserId, t.codeNormalized).where(sql`deleted_at is null`),
    index("coupons_owner_idx").on(t.ownerUserId),
  ],
);

export const eventTypeCoupons = pgTable(
  "event_type_coupons",
  {
    eventTypeId: uuid("event_type_id")
      .notNull()
      .references((): AnyPgColumn => eventTypes.id, { onDelete: "cascade" }),
    couponId: uuid("coupon_id")
      .notNull()
      .references((): AnyPgColumn => coupons.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.eventTypeId, t.couponId] }), index("event_type_coupons_coupon_idx").on(t.couponId)],
);

export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: pk(),
    couponId: uuid("coupon_id")
      .notNull()
      .references((): AnyPgColumn => coupons.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id"),
    inviteeEmailNormalized: text("invitee_email_normalized").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("coupon_redemptions_idx").on(t.couponId, t.inviteeEmailNormalized)],
);

export const paymentsRelations = relations(payments, ({ one }) => ({
  invitee: one(invitees, { fields: [payments.inviteeId], references: [invitees.id], relationName: "payments.invitee_id" }),
  scheduledEvent: one(scheduledEvents, {
    fields: [payments.scheduledEventId],
    references: [scheduledEvents.id],
    relationName: "payments.scheduled_event_id",
  }),
  reservation: one(bookingReservations, {
    fields: [payments.reservationId],
    references: [bookingReservations.id],
    relationName: "payments.reservation_id",
  }),
  coupon: one(coupons, { fields: [payments.couponId], references: [coupons.id], relationName: "payments.coupon_id" }),
}));

export const couponsRelations = relations(coupons, ({ one, many }) => ({
  owner: one(users, { fields: [coupons.ownerUserId], references: [users.id], relationName: "coupons.owner_user_id" }),
  payments: many(payments, { relationName: "payments.coupon_id" }),
  eventTypeLinks: many(eventTypeCoupons, { relationName: "event_type_coupons.coupon_id" }),
  redemptions: many(couponRedemptions, { relationName: "coupon_redemptions.coupon_id" }),
}));

export const eventTypeCouponsRelations = relations(eventTypeCoupons, ({ one }) => ({
  eventType: one(eventTypes, {
    fields: [eventTypeCoupons.eventTypeId],
    references: [eventTypes.id],
    relationName: "event_type_coupons.event_type_id",
  }),
  coupon: one(coupons, {
    fields: [eventTypeCoupons.couponId],
    references: [coupons.id],
    relationName: "event_type_coupons.coupon_id",
  }),
}));

export const couponRedemptionsRelations = relations(couponRedemptions, ({ one }) => ({
  coupon: one(coupons, {
    fields: [couponRedemptions.couponId],
    references: [coupons.id],
    relationName: "coupon_redemptions.coupon_id",
  }),
}));
