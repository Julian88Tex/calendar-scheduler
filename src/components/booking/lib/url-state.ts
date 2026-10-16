// URL state of the booking flow (SPEC BK-08): `?month=YYYY-MM` opens a month, `&date=YYYY-MM-DD` preselects a date in the
// invitee zone, `/{slug}/{eventSlug}/{ISO start}` opens the details form, `back=1` shows the back button, `duration`
// carries the chosen duration (BK-07), and every other parameter (prefill, UTM, display and embed parameters) persists
// across steps. Pure and client safe.
import { isDateString, isMonthString } from "@/components/ui/month-calendar-utils";

/** Parameters the flow manages itself (never copied from the incoming URL as-is). */
const MANAGED = new Set(["month", "date", "duration"]);
/** Parameters that only make sense on one page load. */
const TRANSIENT = new Set(["slot_taken"]);
const MAX_PARAMS = 40;
const MAX_VALUE = 2000;

export type SearchParamsInput = Record<string, string | string[] | undefined> | URLSearchParams;

function entries(sp: SearchParamsInput): [string, string][] {
  if (sp instanceof URLSearchParams) return [...sp.entries()];
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(sp)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (typeof value === "string") out.push([k, value]);
  }
  return out;
}

/** The first value of a parameter. */
export function param(sp: SearchParamsInput, key: string): string | undefined {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? undefined;
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

/** The parameters to keep across steps (prefill, UTM, back, embed and display parameters), in their original order. */
export function carriedParams(sp: SearchParamsInput): [string, string][] {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const [k, v] of entries(sp)) {
    if (MANAGED.has(k) || TRANSIENT.has(k) || seen.has(k)) continue;
    if (k.length > 64 || v.length > MAX_VALUE) continue;
    seen.add(k);
    out.push([k, v]);
    if (out.length >= MAX_PARAMS) break;
  }
  return out;
}

export function parseMonth(v: string | null | undefined): string | null {
  return isMonthString(v) ? v : null;
}

export function parseDate(v: string | null | undefined): string | null {
  return isDateString(v) ? v : null;
}

export function parseDuration(v: string | null | undefined, allowed: readonly number[]): number | null {
  if (!v || !/^\d{1,3}$/.test(v)) return null;
  const n = Number(v);
  return allowed.includes(n) ? n : null;
}

export type FlowUrlState = { month?: string | null; date?: string | null; duration?: number | null; defaultDuration?: number };

function query(carry: readonly [string, string][], s: FlowUrlState): string {
  const q = new URLSearchParams();
  for (const [k, v] of carry) q.append(k, v);
  if (s.duration && s.duration !== s.defaultDuration) q.set("duration", String(s.duration));
  if (s.month) q.set("month", s.month);
  if (s.date) q.set("date", s.date);
  const out = q.toString();
  return out ? `?${out}` : "";
}

/** "2026-10-13T18:00:00Z" (the observed URL form: UTC, no milliseconds). */
export function startSegment(start: string | Date): string {
  const d = start instanceof Date ? start : new Date(start);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The calendar step URL. */
export function calendarHref(basePath: string, carry: readonly [string, string][], s: FlowUrlState): string {
  return `${basePath}${query(carry, s)}`;
}

/** The details form URL of a start. */
export function detailsHref(basePath: string, carry: readonly [string, string][], start: string, s: FlowUrlState): string {
  return `${basePath}/${startSegment(start)}${query(carry, s)}`;
}

/** The start of a details path (`{basePath}/{start}`), or null for the calendar path. */
export function startFromPath(pathname: string, basePath: string): string | null {
  const base = basePath.replace(/\/+$/, "");
  let path = pathname.replace(/\/+$/, "");
  try {
    path = decodeURI(path);
  } catch {
    return null;
  }
  if (!path.startsWith(`${base}/`)) return null;
  const rest = path.slice(base.length + 1);
  if (!rest || rest.includes("/")) return null;
  let segment = rest;
  try {
    segment = decodeURIComponent(rest);
  } catch {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/.test(segment)) return null;
  const d = new Date(segment);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Appends the carried parameters to another path (links to the landing page, the confirmation page). */
export function withCarried(path: string, carry: readonly [string, string][], drop: readonly string[] = []): string {
  const q = new URLSearchParams();
  for (const [k, v] of carry) if (!drop.includes(k)) q.append(k, v);
  const s = q.toString();
  return s ? `${path}${path.includes("?") ? "&" : "?"}${s}` : path;
}

/** Display and embed parameters only (what the landing page passes on to booking pages, BK-25, BK-26). */
const DISPLAY_KEYS = new Set([
  "embed_type",
  "embed_domain",
  "hide_event_type_details",
  "hide_landing_page_details",
  "hide_gdpr_banner",
  "background_color",
  "text_color",
  "primary_color",
  "name",
  "first_name",
  "last_name",
  "email",
  "guests",
  "location",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "salesforce_uuid",
  "for",
]);

/** Parameters a landing page forwards to its event links (prefill, UTM, display and embed parameters). */
export function landingForwardParams(sp: SearchParamsInput): [string, string][] {
  return carriedParams(sp).filter(([k]) => DISPLAY_KEYS.has(k) || /^a([1-9]|10)$/.test(k));
}
