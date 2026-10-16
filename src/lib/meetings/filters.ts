// URL state of the Meetings page (SPEC MT-01, MT-02, MT-05, MT-08, MT-15): the tab, the Date Range dates, the filters
// (Status, Event Types, Invitee Emails, search), the keyset cursor with its page number and the expanded meeting
// (?event={id}), all in the query string so a reload or a shared link shows the same view. Pure: client and server
// safe.
//
//   ?tab=past                         Upcoming (default) | Past | Date Range (tab=range&start=2026-10-01&end=2026-10-31)
//   ?status=canceled                  Status: active (default), canceled, or both ("active,canceled")
//   ?eventTypes=id1,id2               Event Types
//   ?emails=a@example.com,b@...       Invitee Emails
//   ?q=maya                           search (invitee name or email, event name)
//   ?after=cursor&page=2              keyset pagination (before=cursor goes back)
//   ?event=id                         the expanded meeting (deep link)
//
// Defaults are left out of URLs. Changing the tab or a filter starts again at page 1.

export type MeetingsTab = "upcoming" | "past" | "range";
export type MeetingStatus = "active" | "canceled";

export type MeetingsQuery = {
  tab: MeetingsTab;
  /** Whether the URL named the tab (a deep link without one opens the meeting's own tab). */
  tabExplicit: boolean;
  /** Date Range tab: local dates in the viewer's zone, inclusive; null until resolved (default: this month). */
  start: string | null;
  end: string | null;
  /** Never empty; sorted active, canceled. */
  status: MeetingStatus[];
  statusExplicit: boolean;
  eventTypeIds: string[];
  /** Lowercase invitee emails. */
  emails: string[];
  q: string;
  after: string | null;
  before: string | null;
  /** 1-based page number shown in the counter (only meaningful with a cursor). */
  page: number;
  /** The expanded meeting. */
  event: string | null;
};

export const PAGE_SIZE = 25;
export const SEARCH_MAX = 100;
export const MAX_FILTER_EMAILS = 20;
export const MAX_FILTER_EVENT_TYPES = 50;
const MAX_CURSOR = 512;
const MAX_PAGE = 100_000;

export const DEFAULT_STATUS: readonly MeetingStatus[] = ["active"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const EMAIL = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;
const CURSOR = /^[A-Za-z0-9_-]+$/;

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function read(sp: Params, key: string): string | undefined {
  const raw = sp instanceof URLSearchParams ? (sp.get(key) ?? undefined) : sp[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : undefined;
}

/** Date Range years the page accepts (the day after 9999-12-31 has no "YYYY-MM-DD" form, which emptied the range). */
const MIN_YEAR = 1900;
const MAX_YEAR = 2999;
/** The same bounds for the range picker. */
export const RANGE_MIN = `${MIN_YEAR}-01-01`;
export const RANGE_MAX = `${MAX_YEAR}-12-31`;

/** True for a real calendar date "YYYY-MM-DD" (years 1900 to 2999). */
export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  if (y < MIN_YEAR || y > MAX_YEAR) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** True for a plausible email address. */
export function isEmailLike(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value);
}

/**
 * Splits an "Invitee Emails" entry (commas, semicolons, spaces or new lines) into lowercase addresses, deduplicated, in
 * order. Returns the invalid parts separately so the form can say so.
 */
export function parseEmailList(text: string): { emails: string[]; invalid: string[] } {
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const v = part.trim().toLowerCase();
    if (!v) continue;
    if (!isEmailLike(v)) {
      invalid.push(part.trim());
      continue;
    }
    if (!emails.includes(v)) emails.push(v);
  }
  return { emails, invalid };
}

/** The search text kept from the URL: whitespace collapsed, trimmed, at most 100 characters. */
export function cleanSearch(value: string | null | undefined): string {
  return (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX);
}

function parseStatus(raw: string | undefined): MeetingStatus[] | null {
  if (!raw) return null;
  const set = new Set(raw.split(",").map((s) => s.trim().toLowerCase()));
  const out: MeetingStatus[] = [];
  if (set.has("active")) out.push("active");
  if (set.has("canceled")) out.push("canceled");
  return out.length ? out : null;
}

function parseIds(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const v = part.trim().toLowerCase();
    if (UUID.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= MAX_FILTER_EVENT_TYPES) break;
  }
  return out;
}

function parseCursor(raw: string | undefined): string | null {
  return raw && raw.length <= MAX_CURSOR && CURSOR.test(raw) ? raw : null;
}

/** The page state of a URL query; invalid values fall back to the defaults (never throws). */
export function parseMeetingsQuery(sp: Params): MeetingsQuery {
  const tabRaw = read(sp, "tab");
  const tab: MeetingsTab = tabRaw === "past" || tabRaw === "range" || tabRaw === "upcoming" ? tabRaw : "upcoming";
  let start = read(sp, "start") ?? null;
  let end = read(sp, "end") ?? null;
  if (!isIsoDate(start)) start = null;
  if (!isIsoDate(end)) end = null;
  if (start && end && end < start) [start, end] = [end, start];
  if (tab !== "range") {
    start = null;
    end = null;
  } else if (!start || !end) {
    // One date alone is a one-day range.
    start = start ?? end;
    end = end ?? start;
  }
  const status = parseStatus(read(sp, "status"));
  const emails = parseEmailList(read(sp, "emails") ?? "").emails.slice(0, MAX_FILTER_EMAILS);
  const after = parseCursor(read(sp, "after"));
  const before = after ? null : parseCursor(read(sp, "before"));
  const pageRaw = Number(read(sp, "page"));
  const page = (after || before) && Number.isInteger(pageRaw) && pageRaw >= 2 && pageRaw <= MAX_PAGE ? pageRaw : 1;
  const eventRaw = read(sp, "event")?.trim().toLowerCase();
  return {
    tab,
    tabExplicit: tabRaw === tab,
    start,
    end,
    status: status ?? [...DEFAULT_STATUS],
    statusExplicit: status !== null,
    eventTypeIds: parseIds(read(sp, "eventTypes")),
    emails,
    q: cleanSearch(read(sp, "q")),
    after: page > 1 ? after : null,
    before: page > 1 ? before : null,
    page,
    event: eventRaw && UUID.test(eventRaw) ? eventRaw : null,
  };
}

export type QueryPatch = Partial<Pick<MeetingsQuery, "tab" | "start" | "end" | "status" | "eventTypeIds" | "emails" | "q" | "event">> & {
  /** Keep the cursor and page (default: only when nothing but `event` changes). */
  keepPage?: boolean;
  after?: string | null;
  before?: string | null;
  page?: number;
};

function sameStatus(a: readonly MeetingStatus[], b: readonly MeetingStatus[]): boolean {
  return a.length === b.length && a.every((s) => b.includes(s));
}

/** The query string of a page state ("" for the default view), defaults left out. */
export function meetingsSearch(q: MeetingsQuery, patch: QueryPatch = {}): string {
  const onlyEvent = Object.keys(patch).every((k) => k === "event" || k === "keepPage");
  const keepPage = patch.keepPage ?? onlyEvent;
  const tab = patch.tab ?? q.tab;
  const status = patch.status ?? q.status;
  const params = new URLSearchParams();
  if (tab !== "upcoming") params.set("tab", tab);
  if (tab === "range") {
    const start = patch.start !== undefined ? patch.start : q.start;
    const end = patch.end !== undefined ? patch.end : q.end;
    if (start) params.set("start", start);
    if (end) params.set("end", end);
  }
  if (!sameStatus(status, DEFAULT_STATUS)) params.set("status", status.join(","));
  const ids = patch.eventTypeIds ?? q.eventTypeIds;
  if (ids.length) params.set("eventTypes", ids.join(","));
  const emails = patch.emails ?? q.emails;
  if (emails.length) params.set("emails", emails.join(","));
  const search = patch.q !== undefined ? cleanSearch(patch.q) : q.q;
  if (search) params.set("q", search);
  const after = patch.after !== undefined ? patch.after : keepPage ? q.after : null;
  const before = patch.before !== undefined ? patch.before : keepPage ? q.before : null;
  const page = patch.page ?? (keepPage ? q.page : 1);
  if ((after || before) && page > 1) {
    if (after) params.set("after", after);
    else if (before) params.set("before", before);
    params.set("page", String(page));
  }
  const event = patch.event !== undefined ? patch.event : keepPage ? q.event : null;
  if (event) params.set("event", event);
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** "/app/meetings?..." for a page state. */
export function meetingsHref(q: MeetingsQuery, patch: QueryPatch = {}): `/app/meetings${string}` {
  return `/app/meetings${meetingsSearch(q, patch)}`;
}

/** True when a filter or the search narrows the list (the empty state then offers "Clear all filters"). */
export function hasActiveFilters(q: Pick<MeetingsQuery, "status" | "eventTypeIds" | "emails" | "q">): boolean {
  return !sameStatus(q.status, DEFAULT_STATUS) || q.eventTypeIds.length > 0 || q.emails.length > 0 || q.q !== "";
}

/** Number of filters in effect (the "Filter" button count). */
export function activeFilterCount(q: Pick<MeetingsQuery, "status" | "eventTypeIds" | "emails" | "q">): number {
  return (sameStatus(q.status, DEFAULT_STATUS) ? 0 : 1) + (q.eventTypeIds.length ? 1 : 0) + (q.emails.length ? 1 : 0) + (q.q ? 1 : 0);
}

/** The filters of a query reset to the defaults (the tab and dates stay). */
export function clearedFilters(): Pick<MeetingsQuery, "status" | "eventTypeIds" | "emails" | "q"> {
  return { status: [...DEFAULT_STATUS], eventTypeIds: [], emails: [], q: "" };
}

/** The export URL of the current tab and filters (no cursor, no expanded meeting). */
export function exportHref(q: MeetingsQuery): `/api/meetings/export${string}` {
  return `/api/meetings/export${meetingsSearch(q, { event: null, after: null, before: null, page: 1 })}`;
}
