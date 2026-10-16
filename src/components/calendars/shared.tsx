// OWNER: calendar-integrations.
//
// Small pieces shared by the Calendar settings page and the Google Calendar integration page (SPEC CAL-01, CAL-15,
// CAL-21): the calendar color dot, the provider logo tile, the connection status badge, provider labels, the
// connect / reconnect links (GET /api/auth/google/start?intent=connect_calendar, foundation-auth) and the calendar
// pickers' choices (free/busy only calendars: a "Free/busy only" note in the conflict picker, never a destination).
import { Badge } from "@/components/ui/badge";
import { ProviderLogo, type ProviderLogoName } from "@/components/ui/provider-logo";
import { oauthStartPath } from "@/lib/auth/oauth/links";
import type { SettingsCalendar } from "@/lib/calendars/settings";
import { cn } from "@/lib/cn";

export const CALENDAR_SETTINGS_PATH = "/app/availability/calendar-settings";

export type ConnectionStatus = "active" | "needs_reauth" | "error";

/** Google Calendar connect link (returns to `next`, default the Calendar settings page). */
export function googleConnectHref(opts: { next?: string; reconnectId?: string } = {}): string {
  return oauthStartPath("google", {
    intent: "connect_calendar",
    next: opts.next ?? CALENDAR_SETTINGS_PATH,
    ...(opts.reconnectId ? { data: { reconnect: opts.reconnectId } } : {}),
  });
}

/** Display name and logo of a connection's provider. */
export function providerMeta(provider: string): { name: string; logo: ProviderLogoName } {
  switch (provider) {
    case "google":
      return { name: "Google", logo: "google" };
    case "microsoft":
      return { name: "Office 365 / Outlook.com", logo: "outlook" };
    case "calendly_import":
      return { name: "Imported from Calendly", logo: "ics" };
    case "ics":
      return { name: "ICS feed", logo: "ics" };
    default:
      return { name: "Calendar", logo: "caldav" };
  }
}

export function ProviderTile({ provider, size = "md", className }: { provider: ProviderLogoName; size?: "sm" | "md" | "lg"; className?: string }) {
  const box = size === "sm" ? "size-8 rounded-[6px]" : size === "lg" ? "size-14 rounded-[12px]" : "size-10 rounded-[8px]";
  const logo = size === "sm" ? 18 : size === "lg" ? 34 : 24;
  return (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center border border-line bg-white", box, className)}>
      <ProviderLogo provider={provider} size={logo} />
    </span>
  );
}

/** A calendar's color (from the provider) as a small dot; decorative, the name is always next to it. */
export function CalendarDot({ color, className }: { color: string | null; className?: string }) {
  const safe = color && /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : null;
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-3 shrink-0 rounded-full border border-black/10", !safe && "bg-ink-3", className)}
      style={safe ? { backgroundColor: safe } : undefined}
    />
  );
}

const STATUS: Record<ConnectionStatus, { label: string; variant: "success" | "danger" | "warning" }> = {
  active: { label: "Connected", variant: "success" },
  needs_reauth: { label: "Action required", variant: "danger" },
  error: { label: "Error", variant: "warning" },
};

export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const s = STATUS[status];
  return (
    <Badge variant={s.variant} size="sm">
      {s.label}
    </Badge>
  );
}

/** What a broken connection's row says (CAL-15). */
export function connectionProblemText(status: ConnectionStatus): string | null {
  if (status === "needs_reauth") return "We can't access this calendar anymore. Reconnect to keep checking it for conflicts and adding new events to it.";
  if (status === "error") return "We're having trouble reaching this calendar. We'll keep trying; reconnect if this continues.";
  return null;
}

/** The note of a calendar shared with "See only free/busy" (its busy times block bookings; no titles, no events added). */
export const FREE_BUSY_ONLY_NOTE = "Free/busy only";

/** The small note under a calendar in the "Check for conflicts" picker. */
export function conflictCalendarNote(cal: Pick<SettingsCalendar, "busyOnly" | "canWrite" | "isPrimary">): string | undefined {
  if (cal.busyOnly) return FREE_BUSY_ONLY_NOTE;
  if (!cal.canWrite) return "View only";
  return cal.isPrimary ? "Primary calendar" : undefined;
}

/** True when new events can be added to the calendar (CAL-08): writable and not free/busy only. */
export function canReceiveEvents(cal: Pick<SettingsCalendar, "busyOnly" | "canWrite">): boolean {
  return cal.canWrite && !cal.busyOnly;
}

/** The "Add to calendar" picker's choices: per account, the calendars that can receive events (accounts without any are left out). */
export function destinationChoices<C extends { calendars: SettingsCalendar[] }>(connections: readonly C[]): { c: C; cals: SettingsCalendar[] }[] {
  return connections.map((c) => ({ c, cals: c.calendars.filter(canReceiveEvents) })).filter((g) => g.cals.length > 0);
}
