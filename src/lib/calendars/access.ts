// OWNER: calendar-integrations.
//
// Free/busy only calendars (owner request: a work calendar shared into the owner's Google account with "See only
// free/busy" must block booking times; docs/SCOPE.md priority 3). Google lists them with accessRole freeBusyReader:
// no event details, never a destination, no push channels and no change sync; the busy cache reads them through the
// FreeBusy API (providers/google.ts listBusy).
//
// Storage: the schema has no access role column yet (docs/schema-requests/calendar-integrations.md asks for
// calendars.access_role). Until it lands, a Google calendar row carries the marker below in calendars.ctag, a column
// that only CalDAV collections use (CalDAV is out of scope, docs/SCOPE.md), so it is always null for Google rows
// otherwise. Every read and write of the flag goes through this file, so the switch to the new column is local.
import "server-only";
import { isNull, ne, or, type SQL } from "drizzle-orm";
import { calendars } from "@/db/schema";
import type { CalendarProviderId } from "./providers/types";

/** calendars.ctag value of a Google calendar the account sees as free/busy only. */
export const GOOGLE_FREE_BUSY_ONLY_TAG = "google:freeBusyReader";

/** True when a calendar row is free/busy only (its events cannot be read, only its busy times). */
export function isBusyOnlyCalendar(row: { ctag: string | null }): boolean {
  return row.ctag === GOOGLE_FREE_BUSY_ONLY_TAG;
}

/** The column values that store a provider calendar's free/busy only flag (applyCalendarList). */
export function busyOnlyColumns(provider: CalendarProviderId, busyOnly: boolean | undefined): { ctag?: string | null } {
  if (provider !== "google") return {};
  return { ctag: busyOnly ? GOOGLE_FREE_BUSY_ONLY_TAG : null };
}

/** SQL condition: the calendar's events are readable (not free/busy only). */
export function readableCalendarCondition(): SQL {
  return or(isNull(calendars.ctag), ne(calendars.ctag, GOOGLE_FREE_BUSY_ONLY_TAG))!;
}
