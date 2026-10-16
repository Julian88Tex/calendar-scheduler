// OWNER: calendar-integrations.
//
// Provider lookup by connection provider id. docs/SCOPE.md keeps Google Calendar only: microsoft, caldav and ics have no
// implementation (no UI creates such connections), and calendly_import is cache only (served from external_events by
// the busy cache, never fetched). Tests vi.mock this module to plug in the fake provider of tests/helpers.
import "server-only";
import { googleProvider } from "./google";
import type { CalendarProvider, CalendarProviderId } from "./types";

/** The provider implementation, or null when this deployment cannot talk to that provider. */
export function getProvider(id: CalendarProviderId): CalendarProvider | null {
  return id === "google" ? googleProvider : null;
}

/** Providers whose events live only in our cache (never refetched; windows always fresh). */
export function isCacheOnlyProvider(id: CalendarProviderId): boolean {
  return id === "calendly_import";
}
