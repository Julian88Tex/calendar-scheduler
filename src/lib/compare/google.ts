// Google calls of the booking page compare (server only): the visitor's calendar list (calendar.calendarlist.readonly:
// names and colors, no events) and their busy times (calendar.freebusy: start and end only, never titles or details).
// Busy times go back to the browser merged across calendars and are never stored. Only when the visitor asked to see
// event names (calendar.readonly, session.events) are the titles of their own timed events read too, so a Conflict can
// say what it is: they go back to that visitor's browser alone and are never stored or logged.
import "server-only";
import { log } from "@/lib/logger";
import { COMPARE_MAX_TITLES, COMPARE_TITLE_MAX, type CompareEventTitle, type CompareFailure, type CompareFailureReason } from "./constants";
import type { CompareSession } from "./session";

const API = "https://www.googleapis.com/calendar/v3";
const TIMEOUT_MS = 10_000;
const MAX_CALENDARS_LISTED = 50;

export type CompareCalendar = { id: string; name: string; color: string | null; primary: boolean; selected: boolean };
export type BusyRange = { start: number; end: number };

/** Google no longer accepts the token (expired or revoked): the caller ends the connection. */
export class CompareTokenError extends Error {
  constructor() {
    super("compare_token_rejected");
  }
}

async function google(session: CompareSession, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) throw new CompareTokenError();
  return res;
}

/** Primary first, then the calendars shown in the visitor's Google Calendar, then by name. */
export function sortCalendars(list: CompareCalendar[]): CompareCalendar[] {
  return [...list].sort((a, b) => Number(b.primary) - Number(a.primary) || Number(b.selected) - Number(a.selected) || a.name.localeCompare(b.name));
}

/**
 * The visitor's calendars they can see free/busy for. Without the calendar list permission (unchecked on Google's
 * consent screen) the compare still works against the primary calendar alone.
 */
export async function listCompareCalendars(session: CompareSession): Promise<CompareCalendar[]> {
  if (session.fake) {
    return sortCalendars(
      session.fake.calendars.map((c) => ({ id: c.id, name: c.name, color: c.color ?? null, primary: Boolean(c.primary), selected: c.selected ?? Boolean(c.primary) })),
    );
  }
  const primaryOnly: CompareCalendar[] = [{ id: "primary", name: session.email, color: null, primary: true, selected: true }];
  const q = new URLSearchParams({
    minAccessRole: "freeBusyReader",
    maxResults: "250",
    fields: "items(id,summary,summaryOverride,primary,backgroundColor,selected,hidden)",
  });
  const res = await google(session, `/users/me/calendarList?${q}`);
  if (res.status === 403) return primaryOnly;
  if (!res.ok) throw new Error(`google_calendar_list_${res.status}`);
  const data = (await res.json()) as {
    items?: { id?: string; summary?: string; summaryOverride?: string; primary?: boolean; backgroundColor?: string; selected?: boolean; hidden?: boolean }[];
  };
  const out: CompareCalendar[] = [];
  for (const c of data.items ?? []) {
    if (!c.id || c.hidden) continue;
    out.push({
      id: c.id,
      name: (c.summaryOverride || c.summary || c.id).slice(0, 120),
      color: c.backgroundColor && /^#[0-9a-f]{6}$/i.test(c.backgroundColor) ? c.backgroundColor : null,
      primary: Boolean(c.primary),
      selected: Boolean(c.primary || c.selected),
    });
  }
  return out.length ? sortCalendars(out).slice(0, MAX_CALENDARS_LISTED) : primaryOnly;
}

/** Sorted, merged ranges (overlapping or touching ranges become one). */
export function mergeRanges(ranges: readonly BusyRange[]): BusyRange[] {
  const sorted = ranges.filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start).sort((a, b) => a.start - b.start);
  const out: BusyRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Our reason for a Google free/busy calendar error (https://developers.google.com/calendar/api/v3/reference/freebusy/query). */
export function failureReason(googleReasons: readonly (string | undefined)[]): CompareFailureReason {
  if (!googleReasons.length || googleReasons.includes("notFound")) return "no_access";
  if (googleReasons.some((r) => r === "groupTooBig" || r === "tooManyCalendarsRequested")) return "too_many";
  if (googleReasons.some((r) => r === "internalError" || r === "backendError")) return "temporary";
  return "unknown";
}

/** Busy times of the chosen calendars in [start, end), merged, plus the calendars Google could not read and why. */
export async function compareBusy(
  session: CompareSession,
  calendarIds: readonly string[],
  range: { start: Date; end: Date },
): Promise<{ busy: BusyRange[]; failed: CompareFailure[] }> {
  if (session.fake) {
    const all: BusyRange[] = [];
    const failed: CompareFailure[] = [];
    for (const id of calendarIds) {
      const reason = session.fake.failed?.[id];
      if (reason) {
        failed.push({ id, reason });
        continue;
      }
      for (const b of session.fake.busy[id] ?? []) {
        const s = Date.parse(b.start);
        const e = Date.parse(b.end);
        if (s < range.end.getTime() && e > range.start.getTime()) all.push({ start: s, end: e });
      }
    }
    return { busy: mergeRanges(all), failed };
  }
  const res = await google(session, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: range.start.toISOString(), timeMax: range.end.toISOString(), timeZone: "UTC", items: calendarIds.map((id) => ({ id })) }),
  });
  if (!res.ok) throw new Error(`google_freebusy_${res.status}`);
  const data = (await res.json()) as { calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }> };
  const all: BusyRange[] = [];
  const failed: CompareFailure[] = [];
  for (const id of calendarIds) {
    const cal = data.calendars?.[id];
    if (!cal || cal.errors?.length) {
      const reasons = cal?.errors?.map((e) => e.reason) ?? [];
      failed.push({ id, reason: failureReason(reasons) });
      if (reasons.length) log.info("compare.freebusy_calendar_error", { reasons: reasons.map((r) => r ?? "unknown") });
      continue;
    }
    for (const b of cal.busy ?? []) all.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
  }
  return { busy: mergeRanges(all), failed };
}

type GoogleEvent = {
  summary?: string;
  status?: string;
  transparency?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

/** A timed, busy, not declined event with a title, as Google's free/busy counts it; null otherwise. */
export function eventTitle(e: GoogleEvent): CompareEventTitle | null {
  const title = e.summary?.trim();
  if (!title || e.status === "cancelled" || e.transparency === "transparent") return null;
  if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) return null;
  const start = Date.parse(e.start?.dateTime ?? "");
  const end = Date.parse(e.end?.dateTime ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end, title: title.slice(0, COMPARE_TITLE_MAX) };
}

/**
 * The titles of the visitor's own timed events in [start, end) on the chosen calendars, when they allowed reading
 * events; [] otherwise. A calendar Google won't list events of is skipped: its busy times still mark Conflict.
 */
export async function compareEventTitles(session: CompareSession, calendarIds: readonly string[], range: { start: Date; end: Date }): Promise<CompareEventTitle[]> {
  if (!session.events) return [];
  if (session.fake) {
    return calendarIds
      .flatMap((id) => session.fake?.titles?.[id] ?? [])
      .map((t) => ({ start: Date.parse(t.start), end: Date.parse(t.end), title: t.title.slice(0, COMPARE_TITLE_MAX) }))
      .filter((t) => t.start < range.end.getTime() && t.end > range.start.getTime())
      .slice(0, COMPARE_MAX_TITLES);
  }
  const q = new URLSearchParams({
    timeMin: range.start.toISOString(),
    timeMax: range.end.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
    fields: "items(summary,status,transparency,start/dateTime,end/dateTime,attendees(self,responseStatus))",
  });
  const lists = await Promise.all(
    calendarIds.map(async (id) => {
      try {
        const res = await google(session, `/calendars/${encodeURIComponent(id)}/events?${q}`);
        if (!res.ok) return [];
        const data = (await res.json()) as { items?: GoogleEvent[] };
        return (data.items ?? []).map(eventTitle).filter((t): t is CompareEventTitle => t !== null);
      } catch (e) {
        // Names are a nicety: a failed list leaves plain Conflict marks, but a rejected token ends the connection.
        if (e instanceof CompareTokenError) throw e;
        return [];
      }
    }),
  );
  return lists.flat().slice(0, COMPARE_MAX_TITLES);
}
