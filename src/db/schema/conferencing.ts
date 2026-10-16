// ARCHITECTURE section 5.4.7: standalone conferencing connections (Zoom; Webex and GoTo later).
// Google Meet and Microsoft Teams have no row here: they use the Google or Microsoft calendar connection of the
// organizer's destination calendar. Jitsi needs no credentials.
import { relations } from "drizzle-orm";
import { type AnyPgColumn, boolean, index, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, ts, updatedAt } from "./_columns.ts";
import { connectionStatus } from "./_enums.ts";
import { users } from "./auth.ts";

export const conferencingProvider = pgEnum("conferencing_provider", ["zoom", "webex", "gotomeeting"]);

export const conferencingConnections = pgTable(
  "conferencing_connections",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    provider: conferencingProvider("provider").notNull(),
    accountEmail: text("account_email"),
    providerUserId: text("provider_user_id"),
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: ts("token_expires_at"),
    scopes: text("scopes").array().notNull().default([]),
    status: connectionStatus("status").notNull().default("active"),
    lastError: text("last_error"),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    isDefault: boolean("is_default").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("conf_conn_uq").on(t.userId, t.provider, t.providerUserId),
    index("conf_conn_user_idx").on(t.userId),
  ],
);

export const conferencingConnectionsRelations = relations(conferencingConnections, ({ one }) => ({
  user: one(users, {
    fields: [conferencingConnections.userId],
    references: [users.id],
    relationName: "conferencing_connections.user_id",
  }),
}));
