// OWNER: foundation-ui.
//
// Integrations hub (SPEC CAL-21): "Integrations & apps" with search, category chips and tiles from
// src/lib/integrations/catalog.ts. Status per tile: "Not configured on this server" when the env vars are missing
// (beats everything), "Connected" when the user has a live connection (calendars, Zoom, webhooks, API tokens, GA4,
// Meta Pixel; Meet and Teams follow the Google and Microsoft calendar connections), else no badge.
import { and, eq, isNull, ne, or } from "drizzle-orm";
import type { Metadata } from "next";
import { IntegrationsHub, type HubTile } from "../_shell/integrations-hub";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/db";
import { apiTokens, calendarConnections, conferencingConnections, webhookSubscriptions } from "@/db/schema";
import { getActorCtx } from "@/lib/authz";
import { getFeatures } from "@/lib/env";
import { emailTransportLabel, INTEGRATION_CATEGORIES, INTEGRATIONS, integrationStatus, type IntegrationCategory } from "@/lib/integrations/catalog";
import { log } from "@/lib/logger";

export const metadata: Metadata = { title: "Integrations & apps" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

async function connectedIntegrationIds(userId: string, user: { ga4MeasurementId: string | null; metaPixelId: string | null }): Promise<Set<string>> {
  const ids = new Set<string>();
  if (user.ga4MeasurementId) ids.add("google-analytics");
  if (user.metaPixelId) ids.add("meta-pixel");
  try {
    const db = await getDb();
    const [cals, confs, hooks, tokens] = await Promise.all([
      db
        .select({ provider: calendarConnections.provider, server: calendarConnections.caldavServerUrl })
        .from(calendarConnections)
        .where(and(eq(calendarConnections.userId, userId), ne(calendarConnections.status, "disconnected"))),
      db
        .select({ provider: conferencingConnections.provider })
        .from(conferencingConnections)
        .where(and(eq(conferencingConnections.userId, userId), ne(conferencingConnections.status, "disconnected"))),
      db
        .select({ id: webhookSubscriptions.id })
        .from(webhookSubscriptions)
        .where(and(or(eq(webhookSubscriptions.userId, userId), eq(webhookSubscriptions.creatorUserId, userId)), isNull(webhookSubscriptions.disabledAt)))
        .limit(1),
      db
        .select({ id: apiTokens.id })
        .from(apiTokens)
        .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
        .limit(1),
    ]);
    for (const c of cals) {
      if (c.provider === "google") ids.add("google-calendar").add("google-meet");
      else if (c.provider === "microsoft") ids.add("outlook-calendar").add("microsoft-teams");
      else if (c.provider === "ics") ids.add("ics-feed");
      else if (c.provider === "caldav") ids.add(c.server && /icloud\.com/i.test(c.server) ? "icloud-calendar" : "caldav");
    }
    for (const c of confs) if (c.provider === "zoom") ids.add("zoom");
    if (hooks.length) ids.add("webhooks");
    if (tokens.length) ids.add("api");
  } catch (e) {
    log.warn("integrations.status_failed", { error: e });
  }
  return ids;
}

export default async function IntegrationsPage({ searchParams }: Props) {
  const [sp, actor] = await Promise.all([searchParams, getActorCtx()]);
  const f = getFeatures();
  const flags = { googleOAuth: f.googleOAuth, microsoftOAuth: f.microsoftOAuth, zoom: f.zoom, stripe: f.stripe, sms: f.sms, email: f.email };
  const connected = await connectedIntegrationIds(actor.user.id, actor.user);
  const tiles: HubTile[] = INTEGRATIONS.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    href: t.href,
    logo: t.logo,
    status: integrationStatus(t, flags, connected),
    note: t.id === "email" ? emailTransportLabel(f.email) : null,
  }));
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const rawCategory = typeof sp.category === "string" ? sp.category : "all";
  const category = (INTEGRATION_CATEGORIES.some((c) => c.id === rawCategory) ? rawCategory : "all") as IntegrationCategory | "all";
  return (
    <>
      <PageHeader
        title="Integrations & apps"
        description="Connect your calendars, video conferencing, payments and the tools you already use."
        helpHref="/help"
        helpLabel="Help with integrations"
      />
      <IntegrationsHub tiles={tiles} initialQuery={q} initialCategory={category} />
    </>
  );
}
