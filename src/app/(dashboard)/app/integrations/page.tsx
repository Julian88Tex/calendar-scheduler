// OWNER: foundation-ui.
//
// Integrations hub (SPEC CAL-21 narrowed by docs/SCOPE.md): "Integrations & apps" with search, category chips and tiles
// from src/lib/integrations/catalog.ts. docs/SCOPE.md keeps Google Calendar (conflicts and the destination calendar)
// and Google Meet (created through the Google Calendar event), plus the status-only Email delivery tile that tells the
// owner whether booking and reminder emails leave the server; tiles for skipped integrations are not shown. Status per
// tile: "Not configured on this server" when the env vars are missing (beats everything), "Connected" when the user
// has a live Google connection (Meet follows it), else no badge. The Email delivery tile follows the transport that
// actually delivers (resolveEmailTransport: EMAIL_PROVIDER, Resend, SMTP, the owner's Gmail, else the outbox): its note
// is describeEmailTransport ("Sending from owner@gmail.com (Gmail)", ...) and it is "Connected" unless emails only
// reach the outbox.
import { and, eq, ne } from "drizzle-orm";
import type { Metadata } from "next";
import { IntegrationsHub, type HubTile } from "../_shell/integrations-hub";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/db";
import { calendarConnections } from "@/db/schema";
import { getActorCtx } from "@/lib/authz";
import { describeEmailTransport, resolveEmailTransport } from "@/lib/email";
import { getFeatures, type Features } from "@/lib/env";
import {
  emailTransportLabel,
  INTEGRATION_CATEGORIES,
  INTEGRATIONS,
  integrationStatus,
  type IntegrationCategory,
  type IntegrationFeatureFlags,
} from "@/lib/integrations/catalog";
import { log } from "@/lib/logger";

export const metadata: Metadata = { title: "Integrations & apps" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Catalog tiles docs/SCOPE.md keeps, in hub order. */
const KEPT_INTEGRATION_IDS: readonly string[] = ["google-calendar", "google-meet", "email"];

async function connectedIntegrationIds(userId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const db = await getDb();
    const [google] = await db
      .select({ id: calendarConnections.id })
      .from(calendarConnections)
      .where(and(eq(calendarConnections.userId, userId), eq(calendarConnections.provider, "google"), ne(calendarConnections.status, "disconnected")))
      .limit(1);
    if (google) ids.add("google-calendar").add("google-meet");
  } catch (e) {
    log.warn("integrations.status_failed", { error: e });
  }
  return ids;
}

/** The transport that delivers emails and its one line description (the env only transport when that fails). */
async function emailDelivery(configured: Features["email"]): Promise<{ transport: IntegrationFeatureFlags["email"]; note: string }> {
  try {
    const resolution = await resolveEmailTransport();
    return { transport: resolution.name, note: describeEmailTransport(resolution) };
  } catch (e) {
    log.warn("integrations.email_status_failed", { error: e });
    return { transport: configured, note: emailTransportLabel(configured) };
  }
}

export default async function IntegrationsPage({ searchParams }: Props) {
  const [sp, actor] = await Promise.all([searchParams, getActorCtx()]);
  const f = getFeatures();
  const [connected, email] = await Promise.all([connectedIntegrationIds(actor.user.id), emailDelivery(f.email)]);
  const flags: IntegrationFeatureFlags = {
    googleOAuth: f.googleOAuth,
    microsoftOAuth: f.microsoftOAuth,
    zoom: f.zoom,
    stripe: f.stripe,
    sms: f.sms,
    email: email.transport,
  };
  const tiles: HubTile[] = INTEGRATIONS.filter((t) => KEPT_INTEGRATION_IDS.includes(t.id)).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    href: t.href,
    logo: t.logo,
    status: integrationStatus(t, flags, connected),
    note: t.id === "email" ? email.note : null,
  }));
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const rawCategory = typeof sp.category === "string" ? sp.category : "all";
  const keptCategories = new Set(INTEGRATIONS.filter((t) => KEPT_INTEGRATION_IDS.includes(t.id)).map((t) => t.category));
  const categories = INTEGRATION_CATEGORIES.filter((c) => c.id === "all" || keptCategories.has(c.id));
  const category = (categories.some((c) => c.id === rawCategory) ? rawCategory : "all") as IntegrationCategory | "all";
  return (
    <>
      <PageHeader
        title="Integrations & apps"
        description="Connect Google Calendar to check for conflicts, add new meetings to your calendar and give them Google Meet links."
      />
      <IntegrationsHub tiles={tiles} initialQuery={q} initialCategory={category} categories={categories.map((c) => c.id)} />
    </>
  );
}
