// OWNER: calendar-integrations.
//
// Google Calendar v3 over fetch (SPEC CAL-02, CAL-11, CAL-12, CAL-14, SCH-12, VID-07; tech-reference 6).
//
// - listCalendars: calendarList (minAccessRole=freeBusyReader, paged); writable when accessRole is owner or writer;
//   busyOnly when accessRole is freeBusyReader (a calendar shared with "See only free/busy", such as a work calendar
//   shared into a personal account: no event details, so it is read with listBusy).
// - listBusy: the FreeBusy API (POST /freeBusy, timeZone UTC) for busy-only calendars, batched (at most 50 calendars and
//   31 days per request; the busy cache asks for one 31-day window of a connection at a time, so usually one request
//   covers every busy-only calendar of that window). Intervals come back untitled and always busy (Google already
//   leaves out free, declined and cancelled events) and are merged per calendar; ids are synthetic ("freebusy:" plus the
//   interval). A per calendar "notFound" leaves that calendar out (gone, like listEvents); any other per calendar
//   error is transient (the cache keeps the last data). Rate limits map like every other request (403 rateLimitExceeded,
//   429 -> ProviderTransientError).
// - listEvents: events.list per calendar with singleEvents=true, maxAttendees=1 (only our own attendee entry comes back)
//   and explicit eventTypes (default, focusTime, outOfOffice, fromGmail, birthday), so working locations are not even
//   fetched. Busy mapping (SCH-12): cancelled and declined are free, outOfOffice is always busy, every other type
//   (focusTime included) is busy unless transparency = transparent; tentative and unanswered invitations are busy
//   (CAL-09). All-day events keep their calendar dates (start.date, end.date exclusive) and get UTC midnight bounds as
//   placeholders; the busy layer expands them as whole local days in the host's zone.
//   A calendar that refuses the eventTypes filter (400) is read once more without it (working locations are still
//   dropped by the mapping), so one odd calendar never breaks the whole busy fetch. A calendar that refuses events.list
//   (403, or 404) is read through FreeBusy instead: its access may have dropped to free/busy since the calendar list was
//   last read, and its busy times must still block (a calendar FreeBusy cannot see either is left out, as before).
// - getEvent: a 404 also answers for a calendar the user can no longer read, so the event counts as deleted only when
//   its calendar still answers (otherwise ProviderRequestError "calendarUnavailable": CAL-14 must never cancel
//   meetings because a calendar was unshared).
// - createEvent / updateEvent / deleteEvent: events.insert, patch and delete with conferenceDataVersion=1 and
//   sendUpdates=all (calendar invitation mode) or none (email confirmation mode, no attendees). The event id is our
//   deterministic base32hex key, so a retry after a timeout answers 409 and resolves to the event already created
//   (patched to the current input when it differs, so a change made between the attempts is not lost and CAL-14 never
//   mistakes the stale copy for a host-side move).
//   Google Meet: conferenceData.createRequest (hangoutsMeet) with a stable requestId; a pending conference is re-read
//   up to 3 times. Writes return iCalUID and htmlLink (stored on the meeting by lifecycle-core).
// - watchEvents / stopChannel: push notification channels (events.watch, channels.stop).
// Errors: 401 -> ProviderAuthError("unauthorized") (credentials.ts refreshes and retries once); missing scopes or a
// disabled API -> ProviderAuthError; 403 rate limits, 429, 5xx and network failures -> ProviderTransientError; other
// 4xx -> ProviderRequestError.
import "server-only";
import { nowMs } from "@/lib/time/now";
import {
  ProviderAuthError,
  ProviderRequestError,
  ProviderTransientError,
  isProviderGone,
  type CalendarProvider,
  type ConnectionContext,
  type RemoteCalendar,
  type RemoteEvent,
  type WriteEventInput,
  type WriteEventResult,
} from "./types";

export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
/** Per request timeout (callers race the whole busy fetch against their own, shorter budget). */
const REQUEST_TIMEOUT_MS = 15_000;
/** Pages of events.list per calendar and window (2,500 events each). */
const MAX_PAGES = 25;
/** SCH-12: the event types the busy fetch requests (working locations are never busy, so never fetched). */
export const GOOGLE_BUSY_EVENT_TYPES = ["default", "focusTime", "outOfOffice", "fromGmail", "birthday"] as const;
/** FreeBusy: calendars per request (Google's calendarExpansionMax is at most 50). */
export const FREEBUSY_MAX_ITEMS = 50;
/** FreeBusy: longest span per request (the busy cache's 31-day window). */
export const FREEBUSY_MAX_RANGE_MS = 31 * 86_400_000;
/** Prefix of the synthetic ids of FreeBusy intervals (they have no event id). */
export const FREEBUSY_ID_PREFIX = "freebusy:";

/** Re-reads of an event whose Meet conference is still pending (VID-07: up to 3 times). Tests shorten the delays. */
export const googleTiming = { meetPollDelaysMs: [2_000, 5_000, 8_000] as number[] };

// ---------------------------------------------------------------------------------------------------------------
// Wire types (the subset we read)

type GoogleDate = { date?: string; dateTime?: string; timeZone?: string };
export type GoogleEvent = {
  id?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleDate;
  end?: GoogleDate;
  transparency?: "opaque" | "transparent";
  eventType?: string;
  attendees?: { email?: string; self?: boolean; organizer?: boolean; responseStatus?: string }[];
  iCalUID?: string;
  recurringEventId?: string;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  updated?: string;
  etag?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    conferenceId?: string;
    createRequest?: { requestId?: string; status?: { statusCode?: "pending" | "success" | "failure" } };
    entryPoints?: { entryPointType?: string; uri?: string; label?: string }[];
    conferenceSolution?: { name?: string; key?: { type?: string } };
  };
};
type GoogleCalendarListEntry = {
  id?: string;
  summary?: string;
  summaryOverride?: string;
  primary?: boolean;
  accessRole?: "freeBusyReader" | "reader" | "writer" | "owner";
  timeZone?: string;
  backgroundColor?: string;
  deleted?: boolean;
  conferenceProperties?: { allowedConferenceSolutionTypes?: string[] };
};
type GoogleErrorBody = { error?: { code?: number; message?: string; status?: string; errors?: { reason?: string; message?: string }[] } };
type GoogleFreeBusyResponse = {
  calendars?: Record<string, { busy?: { start?: string; end?: string }[]; errors?: { domain?: string; reason?: string }[] }>;
};

// ---------------------------------------------------------------------------------------------------------------
// HTTP

type Query = Record<string, string | readonly string[] | undefined>;

function buildUrl(path: string, query?: Query): string {
  const url = new URL(`${GOOGLE_CALENDAR_API}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined) continue;
    if (typeof v === "string") url.searchParams.set(k, v);
    else for (const item of v) url.searchParams.append(k, item);
  }
  return url.toString();
}

const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded", "backendError"]);

/** Maps a non-2xx Google response to the provider error classes. */
export async function googleError(res: Response): Promise<Error> {
  let body: GoogleErrorBody = {};
  try {
    body = (await res.json()) as GoogleErrorBody;
  } catch {
    // non-JSON error body
  }
  const reason = body.error?.errors?.[0]?.reason ?? null;
  const message = body.error?.message ?? `Google Calendar answered ${res.status}`;
  if (res.status === 401) return new ProviderAuthError(message, "unauthorized");
  if (res.status === 403) {
    if (reason && RATE_LIMIT_REASONS.has(reason)) return new ProviderTransientError(message, 403);
    if (reason === "insufficientPermissions" || /insufficient authentication scopes/i.test(message)) {
      return new ProviderAuthError(message, "insufficient_scope");
    }
    if (reason === "accessNotConfigured" || body.error?.status === "SERVICE_DISABLED") return new ProviderAuthError(message, "api_disabled");
    return new ProviderRequestError(403, message, reason ?? "forbidden");
  }
  if (res.status === 429 || res.status >= 500) return new ProviderTransientError(message, res.status);
  return new ProviderRequestError(res.status, message, reason);
}

async function googleFetch<T>(ctx: ConnectionContext, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T | null> {
  if (!ctx.accessToken) throw new ProviderAuthError("No Google access token", "no_credentials");
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new ProviderTransientError(e instanceof Error ? `Could not reach Google Calendar: ${e.message}` : "Could not reach Google Calendar");
  }
  if (!res.ok) throw await googleError(res);
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderTransientError("Google Calendar returned an unreadable response", res.status);
  }
}

const calPath = (calendarId: string) => `/calendars/${encodeURIComponent(calendarId)}`;

// ---------------------------------------------------------------------------------------------------------------
// Mapping

function utcMidnight(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function nextDate(date: string): string {
  const d = utcMidnight(date);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_TITLES: Record<string, string> = { outOfOffice: "Out of office", focusTime: "Focus time" };

/**
 * One Google event as a RemoteEvent with the SCH-12 busy flag. Returns null for items without times and for working
 * location entries (never busy, never listed) unless `keepAllTypes` (getEvent of our own events).
 */
export function mapGoogleEvent(item: GoogleEvent, opts: { keepAllTypes?: boolean } = {}): RemoteEvent | null {
  if (!item.id) return null;
  const eventType = item.eventType ?? "default";
  if (eventType === "workingLocation" && !opts.keepAllTypes) return null;
  const status = item.status === "cancelled" ? "cancelled" : item.status === "tentative" ? "tentative" : "confirmed";
  const self = item.attendees?.find((a) => a.self);
  const selfDeclined = self?.responseStatus === "declined";
  const transparent = item.transparency === "transparent";
  let busy: boolean;
  if (status === "cancelled" || eventType === "workingLocation") busy = false;
  else if (eventType === "outOfOffice") busy = true;
  else if (selfDeclined) busy = false;
  else busy = !transparent;

  let start: Date;
  let end: Date;
  let allDay = false;
  let allDayStartDate: string | undefined;
  let allDayEndDate: string | undefined;
  if (item.start?.date && ISO_DATE.test(item.start.date)) {
    allDay = true;
    allDayStartDate = item.start.date;
    allDayEndDate = item.end?.date && ISO_DATE.test(item.end.date) && item.end.date > item.start.date ? item.end.date : nextDate(item.start.date);
    start = utcMidnight(allDayStartDate);
    end = utcMidnight(allDayEndDate);
  } else if (item.start?.dateTime) {
    start = new Date(item.start.dateTime);
    if (Number.isNaN(start.getTime())) return null;
    const parsedEnd = item.end?.dateTime ? new Date(item.end.dateTime) : null;
    // SCH-12: an event without a usable end is zero length.
    end = parsedEnd && !Number.isNaN(parsedEnd.getTime()) && parsedEnd >= start ? parsedEnd : new Date(start);
  } else if (status === "cancelled" && opts.keepAllTypes) {
    // A deleted instance read back by id carries no times.
    start = new Date(0);
    end = new Date(0);
  } else {
    return null;
  }

  const title = item.summary?.trim() || DEFAULT_TITLES[eventType] || null;
  return {
    externalId: item.id,
    icalUid: item.iCalUID ?? null,
    recurringEventId: item.recurringEventId ?? null,
    start,
    end,
    allDay,
    ...(allDay ? { allDayStartDate, allDayEndDate } : {}),
    title,
    busy,
    showAs: eventType !== "default" ? eventType : transparent ? "free" : "busy",
    status,
    selfDeclined,
    extendedPrivate: item.extendedProperties?.private ?? {},
    updatedAt: item.updated ? new Date(item.updated) : null,
    etag: item.etag ?? null,
  };
}

/** Google Meet details of an event (VID-07). */
export function meetConference(ev: GoogleEvent): NonNullable<WriteEventResult["conference"]> {
  const video = ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? null;
  const joinUrl = ev.hangoutLink ?? video;
  const statusCode = ev.conferenceData?.createRequest?.status?.statusCode;
  const status = joinUrl ? "pushed" : statusCode === "pending" ? "processing" : "failed";
  return {
    joinUrl: joinUrl ?? null,
    status,
    data: {
      provider: "google_meet",
      conferenceId: ev.conferenceData?.conferenceId ?? null,
      statusCode: statusCode ?? null,
      entryPoints: (ev.conferenceData?.entryPoints ?? []).map((e) => ({ type: e.entryPointType ?? null, uri: e.uri ?? null, label: e.label ?? null })),
    },
  };
}

function writeResult(ev: GoogleEvent, wantsMeet: boolean): WriteEventResult {
  return {
    externalId: ev.id ?? "",
    etag: ev.etag ?? null,
    icalUid: ev.iCalUID ?? null,
    htmlLink: ev.htmlLink ?? null,
    ...(wantsMeet ? { conference: meetConference(ev) } : {}),
  };
}

/** The events.insert / events.patch body for our write input. */
export function googleEventBody(input: WriteEventInput, mode: "create" | "update"): Record<string, unknown> {
  const allDayDate = input.allDay && input.allDayDate && ISO_DATE.test(input.allDayDate) ? input.allDayDate : null;
  const seen = new Set<string>();
  const attendees = input.sendInvitations
    ? input.attendees
        .filter((a) => {
          const key = a.email.trim().toLowerCase();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((a) => ({ email: a.email.trim(), ...(a.name ? { displayName: a.name } : {}), ...(a.optional ? { optional: true } : {}) }))
    : [];
  const body: Record<string, unknown> = {
    summary: input.title,
    description: input.descriptionText,
    start: allDayDate ? { date: allDayDate } : { dateTime: input.start.toISOString() },
    end: allDayDate ? { date: nextDate(allDayDate) } : { dateTime: input.end.toISOString() },
    attendees,
    transparency: input.transparency === "free" ? "transparent" : "opaque",
    visibility: input.visibility ?? "default",
    guestsCanModify: false,
    extendedProperties: { private: input.privateProperties },
  };
  if (input.location) body.location = input.location;
  else if (mode === "update") body.location = "";
  if (mode === "create") {
    body.id = input.idempotencyKey;
    // Provider default reminders (CAL-11); updates leave whatever the host set on the event since.
    body.reminders = { useDefault: true };
  }
  if (input.conference === "google_meet") {
    // Stable requestId: Google ignores a repeated request with the same id, so updates never create a second conference.
    body.conferenceData = { createRequest: { requestId: input.idempotencyKey, conferenceSolutionKey: { type: "hangoutsMeet" } } };
  }
  return body;
}

const sendUpdates = (input: Pick<WriteEventInput, "sendInvitations">) => (input.sendInvitations ? "all" : "none");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------------------
// Provider

async function listCalendars(ctx: ConnectionContext): Promise<RemoteCalendar[]> {
  const out: RemoteCalendar[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await googleFetch<{ items?: GoogleCalendarListEntry[]; nextPageToken?: string }>(ctx, "GET", "/users/me/calendarList", {
      // freeBusyReader too: a calendar shared with "See only free/busy" still blocks times (read with listBusy).
      query: { maxResults: "250", minAccessRole: "freeBusyReader", pageToken },
    });
    for (const c of res?.items ?? []) {
      if (!c.id || c.deleted) continue;
      const busyOnly = c.accessRole === "freeBusyReader";
      out.push({
        externalId: c.id,
        name: c.summaryOverride?.trim() || c.summary?.trim() || c.id,
        color: c.backgroundColor ?? null,
        timeZone: c.timeZone ?? null,
        isPrimary: c.primary === true,
        canWrite: !busyOnly && (c.accessRole === "owner" || c.accessRole === "writer"),
        allowedOnlineMeetingProviders: c.conferenceProperties?.allowedConferenceSolutionTypes ?? [],
        busyOnly,
      });
    }
    pageToken = res?.nextPageToken;
    if (!pageToken) break;
  }
  // Primary first, then calendars the user can write to, then readable ones, then free/busy only ones, each by name.
  return out.sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) ||
      Number(b.canWrite) - Number(a.canWrite) ||
      Number(Boolean(a.busyOnly)) - Number(Boolean(b.busyOnly)) ||
      a.name.localeCompare(b.name),
  );
}

/** An untitled busy interval of a free/busy only calendar, as a RemoteEvent (id synthetic, never all-day). */
export function freeBusyEvent(start: Date, end: Date): RemoteEvent {
  return {
    externalId: `${FREEBUSY_ID_PREFIX}${start.toISOString()}/${end.toISOString()}`,
    icalUid: null,
    recurringEventId: null,
    start,
    end,
    allDay: false,
    title: null,
    busy: true,
    showAs: "busy",
    status: "confirmed",
    selfDeclined: false,
    extendedPrivate: {},
    updatedAt: null,
    etag: null,
  };
}

/** Sorted, merged intervals (overlapping or touching ones become one). */
function mergeIntervals(list: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = [...list].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: { start: number; end: number }[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ ...iv });
  }
  return out;
}

const FREEBUSY_GONE_REASONS = new Set(["notFound"]);

/** FreeBusy for calendars the account sees as free/busy only (see the file header). */
async function listBusy(ctx: ConnectionContext, calendarExternalIds: string[], range: { start: Date; end: Date }): Promise<Record<string, RemoteEvent[]>> {
  const ids = [...new Set(calendarExternalIds)];
  const intervals = new Map<string, { start: number; end: number }[]>(ids.map((id) => [id, []]));
  const gone = new Set<string>();
  const startMs = range.start.getTime();
  const endMs = range.end.getTime();
  for (let from = startMs; from < endMs; from += FREEBUSY_MAX_RANGE_MS) {
    const to = Math.min(endMs, from + FREEBUSY_MAX_RANGE_MS);
    for (let i = 0; i < ids.length; i += FREEBUSY_MAX_ITEMS) {
      const batch = ids.slice(i, i + FREEBUSY_MAX_ITEMS).filter((id) => !gone.has(id));
      if (!batch.length) continue;
      const res = await googleFetch<GoogleFreeBusyResponse>(ctx, "POST", "/freeBusy", {
        body: { timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), timeZone: "UTC", items: batch.map((id) => ({ id })) },
      });
      const answered = res?.calendars ?? {};
      const byLower = new Map(Object.entries(answered).map(([k, v]) => [k.toLowerCase(), v]));
      for (const id of batch) {
        const entry = answered[id] ?? byLower.get(id.toLowerCase());
        if (!entry) {
          gone.add(id);
          continue;
        }
        const reasons = (entry.errors ?? []).map((e) => e.reason ?? "unknown");
        if (reasons.length) {
          if (reasons.every((r) => FREEBUSY_GONE_REASONS.has(r))) {
            gone.add(id);
            continue;
          }
          throw new ProviderTransientError(`Google Calendar could not read the free/busy times of a calendar (${reasons.join(", ")})`);
        }
        const list = intervals.get(id)!;
        for (const b of entry.busy ?? []) {
          const s = b.start ? Date.parse(b.start) : Number.NaN;
          const e = b.end ? Date.parse(b.end) : Number.NaN;
          if (Number.isNaN(s) || Number.isNaN(e) || !(e > s)) continue;
          list.push({ start: s, end: e });
        }
      }
    }
  }
  const out: Record<string, RemoteEvent[]> = {};
  for (const [id, list] of intervals) {
    if (gone.has(id)) continue;
    out[id] = mergeIntervals(list).map((iv) => freeBusyEvent(new Date(iv.start), new Date(iv.end)));
  }
  return out;
}

async function listEventsOf(ctx: ConnectionContext, calendarId: string, range: { start: Date; end: Date }, withTypes = true): Promise<RemoteEvent[]> {
  const out: RemoteEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    let res: { items?: GoogleEvent[]; nextPageToken?: string } | null;
    try {
      res = await googleFetch<{ items?: GoogleEvent[]; nextPageToken?: string }>(ctx, "GET", `${calPath(calendarId)}/events`, {
        query: {
          timeMin: range.start.toISOString(),
          timeMax: range.end.toISOString(),
          singleEvents: "true",
          showDeleted: "false",
          maxResults: "2500",
          maxAttendees: "1",
          eventTypes: withTypes ? GOOGLE_BUSY_EVENT_TYPES : undefined,
          pageToken,
        },
      });
    } catch (e) {
      // A calendar that does not support the eventTypes filter: read every type (the mapping drops working locations).
      if (withTypes && page === 0 && e instanceof ProviderRequestError && e.status === 400) return listEventsOf(ctx, calendarId, range, false);
      throw e;
    }
    for (const item of res?.items ?? []) {
      const ev = mapGoogleEvent(item);
      if (ev && ev.status !== "cancelled") out.push(ev);
    }
    pageToken = res?.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

async function listEvents(ctx: ConnectionContext, calendarExternalIds: string[], range: { start: Date; end: Date }): Promise<Record<string, RemoteEvent[]>> {
  const out: Record<string, RemoteEvent[]> = {};
  await Promise.all(
    calendarExternalIds.map(async (id) => {
      try {
        out[id] = await listEventsOf(ctx, id, range);
      } catch (e) {
        if (!(isProviderGone(e) || (e instanceof ProviderRequestError && e.status === 403))) throw e;
        // Access may have dropped to free/busy only since the list was read: its busy times still block. A calendar
        // that disappeared or was unshared is not in the FreeBusy answer either and is left out (the caller refreshes
        // the list).
        const busy = (await listBusy(ctx, [id], range))[id];
        if (busy) out[id] = busy;
      }
    }),
  );
  return out;
}

async function readEvent(ctx: ConnectionContext, calendarId: string, eventId: string, opts: { allAttendees?: boolean } = {}): Promise<GoogleEvent | null> {
  try {
    return await googleFetch<GoogleEvent>(ctx, "GET", `${calPath(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      query: opts.allAttendees ? {} : { maxAttendees: "1" },
    });
  } catch (e) {
    if (isProviderGone(e)) return null;
    throw e;
  }
}

/** Throws ProviderRequestError("calendarUnavailable") when the calendar itself is gone or no longer readable. */
async function assertCalendarReadable(ctx: ConnectionContext, calendarId: string): Promise<void> {
  try {
    await googleFetch(ctx, "GET", calPath(calendarId));
  } catch (e) {
    if (isProviderGone(e) || (e instanceof ProviderRequestError && e.status === 403)) {
      throw new ProviderRequestError(404, "The calendar is no longer available to this account.", "calendarUnavailable");
    }
    throw e;
  }
}

async function getEvent(ctx: ConnectionContext, calendarExternalId: string, externalId: string): Promise<RemoteEvent | null> {
  const ev = await readEvent(ctx, calendarExternalId, externalId);
  if (!ev) {
    // Google answers 404 both for a purged event and for a calendar we can no longer read: only the first is a delete.
    await assertCalendarReadable(ctx, calendarExternalId);
    return null;
  }
  return mapGoogleEvent(ev, { keepAllTypes: true });
}

/** Re-reads an event while its Meet conference is pending (VID-07). */
async function settleConference(ctx: ConnectionContext, calendarId: string, ev: GoogleEvent): Promise<GoogleEvent> {
  let current = ev;
  for (const delay of googleTiming.meetPollDelaysMs) {
    if (meetConference(current).status !== "processing" || !current.id) break;
    await sleep(delay);
    current = (await readEvent(ctx, calendarId, current.id)) ?? current;
  }
  return current;
}

/** Whether the event a previous attempt created differs from what this write wants (409 resolution). */
export function differsFromInput(ev: GoogleEvent, input: WriteEventInput): boolean {
  const body = googleEventBody(input, "create");
  const instant = (d?: GoogleDate) => (d?.date ? `date:${d.date}` : d?.dateTime ? `at:${new Date(d.dateTime).getTime()}` : "");
  const wanted = (k: "start" | "end") => instant(body[k] as GoogleDate);
  if (instant(ev.start) !== wanted("start") || instant(ev.end) !== wanted("end")) return true;
  if ((ev.summary ?? "") !== input.title || (ev.description ?? "") !== input.descriptionText) return true;
  if ((ev.location ?? "") !== (input.location ?? "")) return true;
  if ((ev.transparency ?? "opaque") !== body.transparency) return true;
  const emails = (list: { email?: string }[]) => [...new Set(list.map((a) => (a.email ?? "").trim().toLowerCase()).filter(Boolean))].sort().join(",");
  // Our attendees are the invitee and guests; the calendar owner (organizer) may be listed by Google too.
  const guests = (ev.attendees ?? []).filter((a) => !a.self && !a.organizer);
  if (emails(guests) !== emails(body.attendees as { email: string }[])) return true;
  if (input.conference === "google_meet" && !ev.conferenceData && !ev.hangoutLink) return true;
  return false;
}

async function createEvent(ctx: ConnectionContext, calendarExternalId: string, input: WriteEventInput): Promise<WriteEventResult> {
  const wantsMeet = input.conference === "google_meet";
  let ev: GoogleEvent | null;
  try {
    ev = await googleFetch<GoogleEvent>(ctx, "POST", `${calPath(calendarExternalId)}/events`, {
      query: { conferenceDataVersion: "1", sendUpdates: sendUpdates(input) },
      body: googleEventBody(input, "create"),
    });
  } catch (e) {
    if (!(e instanceof ProviderRequestError) || e.status !== 409) throw e;
    // Our deterministic id already exists: a previous attempt created it (retry after a timeout).
    const existing = await readEvent(ctx, calendarExternalId, input.idempotencyKey, { allAttendees: true });
    if (!existing || existing.status === "cancelled") throw new ProviderRequestError(409, "The event id is already used by a deleted event.", "duplicate");
    // The meeting may have changed between the attempts (time, guests, details): bring the event up to date.
    if (differsFromInput(existing, input)) return updateEvent(ctx, calendarExternalId, input.idempotencyKey, input);
    ev = existing;
  }
  if (!ev?.id) throw new ProviderTransientError("Google Calendar did not return the created event");
  if (wantsMeet) ev = await settleConference(ctx, calendarExternalId, ev);
  return writeResult(ev, wantsMeet);
}

async function updateEvent(
  ctx: ConnectionContext,
  calendarExternalId: string,
  externalId: string,
  input: WriteEventInput,
): Promise<WriteEventResult> {
  const wantsMeet = input.conference === "google_meet";
  let ev = await googleFetch<GoogleEvent>(ctx, "PATCH", `${calPath(calendarExternalId)}/events/${encodeURIComponent(externalId)}`, {
    query: { conferenceDataVersion: "1", sendUpdates: sendUpdates(input) },
    body: googleEventBody(input, "update"),
  });
  if (!ev?.id) throw new ProviderTransientError("Google Calendar did not return the updated event");
  if (wantsMeet) ev = await settleConference(ctx, calendarExternalId, ev);
  return writeResult(ev, wantsMeet);
}

async function deleteEvent(
  ctx: ConnectionContext,
  calendarExternalId: string,
  externalId: string,
  opts: { notifyAttendees: boolean; comment?: string },
): Promise<void> {
  try {
    await googleFetch(ctx, "DELETE", `${calPath(calendarExternalId)}/events/${encodeURIComponent(externalId)}`, {
      query: { sendUpdates: opts.notifyAttendees ? "all" : "none" },
    });
  } catch (e) {
    if (isProviderGone(e)) return; // already deleted
    throw e;
  }
}

/** The Meet conference of an existing event (re-read after a pending create, VID-07). */
export async function readGoogleConference(ctx: ConnectionContext, calendarExternalId: string, externalId: string): Promise<WriteEventResult["conference"] | null> {
  const ev = await readEvent(ctx, calendarExternalId, externalId);
  return ev && ev.status !== "cancelled" ? meetConference(ev) : null;
}

export const googleProvider: CalendarProvider = {
  id: "google",
  capabilities: { write: true, invitations: true, conferences: ["google_meet"], changeSync: true },
  listCalendars,
  listEvents,
  listBusy,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
};

// ---------------------------------------------------------------------------------------------------------------
// Push notifications (P3, ARCHITECTURE 10.3)

export type GoogleWatchResult = { channelId: string; resourceId: string | null; expiresAt: Date };

/** events.watch on one calendar: Google POSTs change notifications to `address` until the channel expires. */
export async function watchGoogleEvents(
  ctx: ConnectionContext,
  calendarExternalId: string,
  p: { channelId: string; address: string; token: string; ttlSeconds: number },
): Promise<GoogleWatchResult> {
  const res = await googleFetch<{ id?: string; resourceId?: string; expiration?: string }>(ctx, "POST", `${calPath(calendarExternalId)}/events/watch`, {
    body: { id: p.channelId, type: "web_hook", address: p.address, token: p.token, params: { ttl: String(p.ttlSeconds) } },
  });
  const expiration = Number(res?.expiration);
  return {
    channelId: res?.id ?? p.channelId,
    resourceId: res?.resourceId ?? null,
    expiresAt: new Date(Number.isFinite(expiration) && expiration > 0 ? expiration : nowMs() + p.ttlSeconds * 1000),
  };
}

/** channels.stop (best effort: a channel that already expired answers 404). */
export async function stopGoogleChannel(ctx: ConnectionContext, p: { channelId: string; resourceId: string | null }): Promise<void> {
  if (!p.resourceId) return;
  try {
    await googleFetch(ctx, "POST", "/channels/stop", { body: { id: p.channelId, resourceId: p.resourceId } });
  } catch (e) {
    if (isProviderGone(e)) return;
    throw e;
  }
}
