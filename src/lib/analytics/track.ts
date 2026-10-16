// OWNER: analytics. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Public page tracking (SPEC AN-12, BK-29): inserts analytics_events rows with a per-tab session id and no PII.
// Foundation stub: no-op.
import "server-only";
import type { analyticsEvents } from "@/db/schema";

export type AnalyticsEventKind = (typeof analyticsEvents.$inferSelect)["kind"];

export type TrackPublicEventInput = {
  kind: AnalyticsEventKind;
  organizationId?: string | null;
  userId?: string | null;
  teamId?: string | null;
  eventTypeId?: string | null;
  routingFormId?: string | null;
  pollId?: string | null;
  /** Random per tab (not a cookie). */
  sessionId?: string | null;
  embed?: boolean;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrerHost?: string | null;
};

export async function trackPublicEvent(input: TrackPublicEventInput): Promise<void> {
  void input;
}
