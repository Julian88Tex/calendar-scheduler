// Integrations hub tile metadata (SPEC CAL-21; ARCHITECTURE sections 3.1 and 3.2). Client and server safe: pure data
// plus a status function that takes the `features` flags (computed server side by src/lib/env.ts) so env values never
// reach client bundles.
//
// Detail routes: /app/integrations/calendars/[provider] (calendar-integrations), /app/integrations/conferencing/
// [provider] (conferencing), /app/integrations/{stripe, twilio, webhooks, api, embed, analytics} (their modules).
// The provider slugs below are the [provider] route params those modules must accept.

export const INTEGRATION_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "calendars", label: "Calendars" },
  { id: "video", label: "Video conferencing" },
  { id: "payments", label: "Payments" },
  { id: "messaging", label: "Messaging" },
  { id: "developer", label: "Developer tools" },
  { id: "analytics", label: "Analytics" },
] as const;
export type IntegrationCategory = Exclude<(typeof INTEGRATION_CATEGORIES)[number]["id"], "all">;

/** /app/integrations/calendars/[provider] params. */
export const CALENDAR_PROVIDER_SLUGS = ["google", "microsoft", "icloud", "caldav", "ics"] as const;
export type CalendarProviderSlug = (typeof CALENDAR_PROVIDER_SLUGS)[number];

/** /app/integrations/conferencing/[provider] params. */
export const CONFERENCING_PROVIDER_SLUGS = ["zoom", "google-meet", "microsoft-teams", "jitsi"] as const;
export type ConferencingProviderSlug = (typeof CONFERENCING_PROVIDER_SLUGS)[number];

/** ProviderLogo names (ARCHITECTURE 20.2). */
export type ProviderLogoName =
  | "google" | "microsoft" | "outlook" | "apple" | "caldav" | "ics" | "zoom" | "meet" | "teams" | "jitsi" | "webex"
  | "gotomeeting" | "stripe" | "paypal" | "twilio" | "webhook" | "email" | "api" | "embed" | "analytics" | "meta";

/** Server-derived flags the tiles need (subset of src/lib/env.ts Features). */
export type IntegrationFeatureFlags = {
  googleOAuth: boolean;
  microsoftOAuth: boolean;
  zoom: boolean;
  stripe: boolean;
  sms: boolean;
  email: "resend" | "smtp" | "outbox";
};

export type IntegrationTile = {
  id: string;
  name: string;
  description: string;
  category: IntegrationCategory;
  logo: ProviderLogoName;
  /** Detail page, or null for status-only tiles (Email delivery). */
  href: string | null;
  /** Env based requirement: the tile shows "Not configured on this server" when it returns false. */
  requires?: (f: IntegrationFeatureFlags) => boolean;
  /** Words matched by the hub search box besides the name and description. */
  keywords?: string[];
};

export const INTEGRATIONS: readonly IntegrationTile[] = [
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Check Gmail and Google Workspace calendars for conflicts and add new events as they are scheduled.",
    category: "calendars",
    logo: "google",
    href: "/app/integrations/calendars/google",
    requires: (f) => f.googleOAuth,
    keywords: ["gmail", "workspace"],
  },
  {
    id: "outlook-calendar",
    name: "Outlook Calendar",
    description: "Connect Office 365 and Outlook.com calendars to check for conflicts and add events.",
    category: "calendars",
    logo: "outlook",
    href: "/app/integrations/calendars/microsoft",
    requires: (f) => f.microsoftOAuth,
    keywords: ["microsoft", "office 365", "exchange"],
  },
  {
    id: "icloud-calendar",
    name: "iCloud Calendar",
    description: "Connect your Apple calendar with an app-specific password.",
    category: "calendars",
    logo: "apple",
    href: "/app/integrations/calendars/icloud",
    keywords: ["apple", "caldav"],
  },
  {
    id: "caldav",
    name: "CalDAV",
    description: "Connect any CalDAV server, such as Nextcloud, Fastmail or Radicale.",
    category: "calendars",
    logo: "caldav",
    href: "/app/integrations/calendars/caldav",
    keywords: ["nextcloud", "fastmail"],
  },
  {
    id: "ics-feed",
    name: "ICS feed",
    description: "Subscribe to a read-only calendar feed so its events block your availability.",
    category: "calendars",
    logo: "ics",
    href: "/app/integrations/calendars/ics",
    keywords: ["ical", "webcal", "subscription"],
  },
  {
    id: "google-meet",
    name: "Google Meet",
    description: "Add a Google Meet link to meetings booked on your Google Calendar.",
    category: "video",
    logo: "meet",
    href: "/app/integrations/conferencing/google-meet",
    requires: (f) => f.googleOAuth,
  },
  {
    id: "microsoft-teams",
    name: "Microsoft Teams",
    description: "Add a Teams meeting link to meetings booked on your work or school Outlook calendar.",
    category: "video",
    logo: "teams",
    href: "/app/integrations/conferencing/microsoft-teams",
    requires: (f) => f.microsoftOAuth,
  },
  {
    id: "zoom",
    name: "Zoom",
    description: "Create a unique Zoom meeting for every booking.",
    category: "video",
    logo: "zoom",
    href: "/app/integrations/conferencing/zoom",
    requires: (f) => f.zoom,
  },
  {
    id: "jitsi",
    name: "Jitsi Meet",
    description: "Free video meetings with no account required.",
    category: "video",
    logo: "jitsi",
    href: "/app/integrations/conferencing/jitsi",
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Collect payments when invitees book paid events.",
    category: "payments",
    logo: "stripe",
    href: "/app/integrations/stripe",
    requires: (f) => f.stripe,
    keywords: ["payment", "card"],
  },
  {
    id: "twilio",
    name: "Twilio SMS",
    description: "Send text reminders and notifications from workflows.",
    category: "messaging",
    logo: "twilio",
    href: "/app/integrations/twilio",
    requires: (f) => f.sms,
    keywords: ["sms", "text"],
  },
  {
    id: "email",
    name: "Email delivery",
    description: "How this server sends notification emails.",
    category: "messaging",
    logo: "email",
    href: null,
    keywords: ["resend", "smtp", "outbox"],
  },
  {
    id: "webhooks",
    name: "Webhooks",
    description: "Send booking, cancellation and form events to your own endpoints.",
    category: "developer",
    logo: "webhook",
    href: "/app/integrations/webhooks",
  },
  {
    id: "api",
    name: "API and personal access tokens",
    description: "Build your own integrations with the REST API.",
    category: "developer",
    logo: "api",
    href: "/app/integrations/api",
    keywords: ["token", "rest"],
  },
  {
    id: "embed",
    name: "Embed",
    description: "Add your scheduling page to your website inline, as a popup widget or as a popup text link.",
    category: "developer",
    logo: "embed",
    href: "/app/integrations/embed",
    keywords: ["website", "widget", "iframe"],
  },
  {
    id: "google-analytics",
    name: "Google Analytics",
    description: "Track visits and bookings on your scheduling pages with GA4.",
    category: "analytics",
    logo: "analytics",
    href: "/app/integrations/analytics",
    keywords: ["ga4"],
  },
  {
    id: "meta-pixel",
    name: "Meta Pixel",
    description: "Measure conversions from your scheduling pages with the Meta Pixel.",
    category: "analytics",
    logo: "meta",
    href: "/app/integrations/analytics",
    keywords: ["facebook"],
  },
];

export type IntegrationStatus = "connected" | "available" | "not_configured";

/** Copy for the status badge. */
export const INTEGRATION_STATUS_LABELS: Record<IntegrationStatus, string> = {
  connected: "Connected",
  available: "Available",
  not_configured: "Not configured on this server",
};

/** Whether the server supports the tile (env based). */
export function isIntegrationConfigured(tile: IntegrationTile, flags: IntegrationFeatureFlags): boolean {
  return tile.requires ? tile.requires(flags) : true;
}

/** The tile status: not configured beats connected; `connectedIds` come from the user's connections. */
export function integrationStatus(
  tile: IntegrationTile,
  flags: IntegrationFeatureFlags,
  connectedIds: ReadonlySet<string> = new Set(),
): IntegrationStatus {
  if (!isIntegrationConfigured(tile, flags)) return "not_configured";
  if (tile.id === "email") return flags.email === "outbox" ? "available" : "connected";
  return connectedIds.has(tile.id) ? "connected" : "available";
}

/** Case-insensitive hub search over name, description and keywords, optionally within a category. */
export function filterIntegrations(query: string, category: IntegrationCategory | "all" = "all"): IntegrationTile[] {
  const q = query.trim().toLowerCase();
  return INTEGRATIONS.filter((t) => {
    if (category !== "all" && t.category !== category) return false;
    if (!q) return true;
    return [t.name, t.description, ...(t.keywords ?? [])].some((s) => s.toLowerCase().includes(q));
  });
}

/** Human description of the email transport (Email delivery tile). */
export function emailTransportLabel(transport: IntegrationFeatureFlags["email"]): string {
  return transport === "resend" ? "Sending with Resend" : transport === "smtp" ? "Sending with SMTP" : "Stored in the outbox (no email provider configured)";
}
