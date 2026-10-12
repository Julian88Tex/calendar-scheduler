// ARCHITECTURE section 5.4.17: webhook subscriptions and deliveries, personal access tokens, calendar feeds (API-17).
import { relations, sql } from "drizzle-orm";
import { type AnyPgColumn, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, ts, updatedAt } from "./_columns.ts";
import { users } from "./auth.ts";
import { groups, organizations } from "./organizations.ts";

export const webhookScope = pgEnum("webhook_scope", ["organization", "user", "group"]);
export const webhookState = pgEnum("webhook_state", ["active", "disabled"]);
export const webhookDeliveryStatus = pgEnum("webhook_delivery_status", ["pending", "succeeded", "failed", "giving_up"]);

export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: pk(),
    organizationId: uuid("organization_id")
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: "cascade" }),
    scope: webhookScope("scope").notNull(),
    userId: uuid("user_id").references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references((): AnyPgColumn => groups.id, { onDelete: "cascade" }),
    callbackUrl: text("callback_url").notNull(),
    events: text("events").array().notNull(),
    signingKeyEnc: text("signing_key_enc").notNull(),
    state: webhookState("state").notNull().default("active"),
    retryStartedAt: ts("retry_started_at"),
    disabledAt: ts("disabled_at"),
    creatorUserId: uuid("creator_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    description: text("description"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("webhooks_org_state_idx").on(t.organizationId, t.state),
    index("webhooks_user_idx").on(t.userId),
    index("webhooks_group_idx").on(t.groupId),
    index("webhooks_creator_idx").on(t.creatorUserId),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: pk(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references((): AnyPgColumn => webhookSubscriptions.id, { onDelete: "cascade" }),
    domainEventId: uuid("domain_event_id"),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    status: webhookDeliveryStatus("status").notNull().default("pending"),
    attempt: integer("attempt").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at"),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"), // truncated 10 KB
    durationMs: integer("duration_ms"),
    error: text("error"),
    // manual redelivery (API-11) or test send source
    redeliveryOfId: uuid("redelivery_of_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deliveredAt: ts("delivered_at"),
  },
  (t) => [
    index("deliveries_sub_idx").on(t.subscriptionId, t.createdAt),
    index("deliveries_due_idx").on(t.status, t.nextAttemptAt),
    // a retried fan-out never duplicates
    uniqueIndex("deliveries_fanout_uq")
      .on(t.subscriptionId, t.domainEventId, t.event)
      .where(sql`domain_event_id is not null and redelivery_of_id is null`),
  ],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    prefix: text("prefix").notNull(), // 'kai_pat_' + 4 chars
    scopes: text("scopes").array().notNull(),
    lastUsedAt: ts("last_used_at"),
    lastUsedIp: text("last_used_ip"),
    expiresAt: ts("expires_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_tokens_hash_uq").on(t.tokenHash), index("api_tokens_user_idx").on(t.userId)],
);

/** API-17 private calendar feed. */
export const calendarFeeds = pgTable(
  "calendar_feeds",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(), // lookup
    tokenEnc: text("token_enc").notNull(), // encrypted copy so the URL can be shown again
    createdAt: createdAt(),
    rotatedAt: ts("rotated_at"),
  },
  (t) => [uniqueIndex("calendar_feeds_user_uq").on(t.userId), uniqueIndex("calendar_feeds_token_uq").on(t.tokenHash)],
);

export const webhookSubscriptionsRelations = relations(webhookSubscriptions, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [webhookSubscriptions.organizationId],
    references: [organizations.id],
    relationName: "webhook_subscriptions.organization_id",
  }),
  user: one(users, {
    fields: [webhookSubscriptions.userId],
    references: [users.id],
    relationName: "webhook_subscriptions.user_id",
  }),
  group: one(groups, {
    fields: [webhookSubscriptions.groupId],
    references: [groups.id],
    relationName: "webhook_subscriptions.group_id",
  }),
  creator: one(users, {
    fields: [webhookSubscriptions.creatorUserId],
    references: [users.id],
    relationName: "webhook_subscriptions.creator_user_id",
  }),
  deliveries: many(webhookDeliveries, { relationName: "webhook_deliveries.subscription_id" }),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  subscription: one(webhookSubscriptions, {
    fields: [webhookDeliveries.subscriptionId],
    references: [webhookSubscriptions.id],
    relationName: "webhook_deliveries.subscription_id",
  }),
}));

export const apiTokensRelations = relations(apiTokens, ({ one }) => ({
  user: one(users, { fields: [apiTokens.userId], references: [users.id], relationName: "api_tokens.user_id" }),
}));

export const calendarFeedsRelations = relations(calendarFeeds, ({ one }) => ({
  user: one(users, { fields: [calendarFeeds.userId], references: [users.id], relationName: "calendar_feeds.user_id" }),
}));
