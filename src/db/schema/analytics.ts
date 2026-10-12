// ARCHITECTURE section 5.4.16: first-party analytics events (no foreign keys: rows outlive what they reference).
import { boolean, index, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk } from "./_columns.ts";

export const analyticsEventKind = pgEnum("analytics_event_kind", [
  "profile_page_viewed",
  "event_type_viewed",
  "date_and_time_selected",
  "event_scheduled",
  "routing_form_viewed",
  "routing_form_submitted",
  "poll_viewed",
]);

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: pk(),
    kind: analyticsEventKind("kind").notNull(),
    organizationId: uuid("organization_id"),
    userId: uuid("user_id"),
    teamId: uuid("team_id"),
    eventTypeId: uuid("event_type_id"),
    routingFormId: uuid("routing_form_id"),
    pollId: uuid("poll_id"),
    sessionId: text("session_id"), // random per tab, not a cookie
    embed: boolean("embed").notNull().default(false),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    referrerHost: text("referrer_host"),
    createdAt: createdAt(),
  },
  (t) => [
    index("analytics_org_kind_idx").on(t.organizationId, t.kind, t.createdAt),
    index("analytics_type_kind_idx").on(t.eventTypeId, t.kind, t.createdAt),
    index("analytics_user_kind_idx").on(t.userId, t.kind, t.createdAt),
  ],
);
