// Links into the Availability area (client and server safe). Booking pages use troubleshootHref for the host-only
// "Troubleshoot" link on the owner's own booking page (SPEC BK-24, docs/SCOPE.md priority 4).
import type { Route } from "next";

export const AVAILABILITY_PATH = "/app/availability";
export const ADVANCED_SETTINGS_PATH = "/app/availability/advanced";
export const TROUBLESHOOT_PATH = "/app/availability/advanced/troubleshoot";

/** The Schedules tab, optionally on one schedule and view. */
export function scheduleHref(scheduleId?: string | null, view?: "list" | "calendar"): Route {
  const qs = new URLSearchParams();
  if (scheduleId) qs.set("schedule", scheduleId);
  if (view === "calendar") qs.set("view", "calendar");
  const q = qs.toString();
  return (q ? `${AVAILABILITY_PATH}?${q}` : AVAILABILITY_PATH) as Route;
}

/**
 * The Troubleshoot view for a local date ("YYYY-MM-DD", default today) and optionally one event type and duration:
 * /app/availability/advanced/troubleshoot?eventType={id}&date=2026-10-14&duration=30
 */
export function troubleshootHref(opts: { eventTypeId?: string | null; date?: string | null; durationMinutes?: number | null } = {}): Route {
  const qs = new URLSearchParams();
  if (opts.eventTypeId) qs.set("eventType", opts.eventTypeId);
  if (opts.date) qs.set("date", opts.date);
  if (opts.durationMinutes) qs.set("duration", String(opts.durationMinutes));
  const q = qs.toString();
  return (q ? `${TROUBLESHOOT_PATH}?${q}` : TROUBLESHOOT_PATH) as Route;
}
