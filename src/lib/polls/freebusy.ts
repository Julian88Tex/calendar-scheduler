// "Check my calendar" for voters (SPEC MP-13, P3; research meeting-polls.md B5.7). Server only.
//
// Sources: Google (FreeBusy with the calendar.freebusy scope) or Microsoft (calendarView) through the poll_freebusy
// OAuth intent (voter-oauth.ts), "Paste an ICS link" (fetched with safeFetch, parsed with node-ical, recurrences
// expanded), or the signed-in app user's own conflict calendars. Provider tokens are used in memory for one request and
// never stored anywhere (MP-13 acceptance). The result (busy, free or unknown per option) is kept only in the voter's
// browser: a signed httpOnly cookie on the voter page path /p/{slug} (FREEBUSY_COOKIE, 30 minutes) holding one character per
// option, which the voter page reads back (readVoterCalendarCheck). Event titles are never kept.
import "server-only";
import { createHash, createHmac } from "node:crypto";
import ical, { expandRecurringEvent, type VEvent } from "node-ical";
import { getExternalBusy } from "@/lib/calendars";
import { appendEmbedSafeCookie, deleteEmbedSafeCookie, readEmbedSafeCookie, readEmbedSafeCookieFromHeaders, setEmbedSafeCookie } from "@/lib/cookies";
import { timingSafeEqualStr } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { normalizeFeedUrl, safeFetch } from "@/lib/net/safe-fetch";
import { getSecret } from "@/lib/secrets";
import { FREEBUSY_COOKIE, FREEBUSY_COOKIE_MAX_AGE_SECONDS, POLL_ERRORS } from "./constants";
import { editCookiePaths } from "./tokens";
import { endOf, startOf, type OptionRow, type PollRow } from "./load";
import type { FreeBusyStatus, VoterCalendarCheck } from "./types";

const DAY = 86_400_000;
const CHUNK_DAYS = 60;

export type Busy = { start: number; end: number };

/** The range a check must cover: the poll's future options (null when none). */
export function checkRange(poll: Pick<PollRow, "timezone">, options: readonly OptionRow[], now: Date): { start: Date; end: Date } | null {
  const future = options.filter((o) => startOf(o, poll.timezone) > now.getTime());
  if (!future.length) return null;
  return {
    start: new Date(Math.min(...future.map((o) => startOf(o, poll.timezone)))),
    end: new Date(Math.max(...future.map((o) => endOf(o, poll.timezone)))),
  };
}

/** Busy / free per option (past options: unknown). */
export function statusesFor(poll: Pick<PollRow, "timezone">, options: readonly OptionRow[], busy: readonly Busy[], now: Date): Record<string, FreeBusyStatus> {
  const out: Record<string, FreeBusyStatus> = {};
  for (const o of options) {
    const s = startOf(o, poll.timezone);
    const e = endOf(o, poll.timezone);
    if (s <= now.getTime()) {
      out[o.id] = "unknown";
      continue;
    }
    out[o.id] = busy.some((b) => b.start < e && s < b.end) ? "busy" : "free";
  }
  return out;
}

function chunks(start: Date, end: Date): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  for (let s = start.getTime(); s < end.getTime(); s += CHUNK_DAYS * DAY) out.push({ start: new Date(s), end: new Date(Math.min(end.getTime(), s + CHUNK_DAYS * DAY)) });
  return out;
}

/** Google FreeBusy for the primary calendar (MP-13). */
export async function googleBusy(accessToken: string, range: { start: Date; end: Date }): Promise<Busy[]> {
  const out: Busy[] = [];
  for (const c of chunks(range.start, range.end)) {
    const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ timeMin: c.start.toISOString(), timeMax: c.end.toISOString(), timeZone: "UTC", items: [{ id: "primary" }] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`google_freebusy_${res.status}`);
    const data = (await res.json()) as { calendars?: Record<string, { busy?: { start: string; end: string }[] }> };
    for (const cal of Object.values(data.calendars ?? {})) for (const b of cal.busy ?? []) out.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
  }
  return out;
}

/** Microsoft calendarView of the default calendar (busy, tentative, out of office and working elsewhere count). */
export async function microsoftBusy(accessToken: string, range: { start: Date; end: Date }): Promise<Busy[]> {
  const out: Busy[] = [];
  for (const c of chunks(range.start, range.end)) {
    let url: string | null =
      `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(c.start.toISOString())}&endDateTime=${encodeURIComponent(c.end.toISOString())}&$select=start,end,showAs,isCancelled&$top=500`;
    let pages = 0;
    while (url && pages++ < 20) {
      const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`graph_calendarview_${res.status}`);
      const data = (await res.json()) as { value?: { start: { dateTime: string }; end: { dateTime: string }; showAs?: string; isCancelled?: boolean }[]; "@odata.nextLink"?: string };
      for (const e of data.value ?? []) {
        if (e.isCancelled || e.showAs === "free") continue;
        const z = (s: string) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
        out.push({ start: z(e.start.dateTime), end: z(e.end.dateTime) });
      }
      url = data["@odata.nextLink"] ?? null;
    }
  }
  return out;
}

/** "Paste an ICS link": https (or webcal) feeds only, through safeFetch (SSRF safe, 5 MB, 15 seconds). */
export async function icsBusy(rawUrl: string, range: { start: Date; end: Date }): Promise<Busy[]> {
  let url: string;
  try {
    url = normalizeFeedUrl(rawUrl);
  } catch {
    throw new AppError("validation", POLL_ERRORS.icsInvalid, { fieldErrors: { icsUrl: [POLL_ERRORS.icsInvalid] } });
  }
  let text: string;
  try {
    const res = await safeFetch(url, { headers: { Accept: "text/calendar" }, timeoutMs: 15_000, maxBytes: 5 * 1024 * 1024 });
    if (!res.ok) throw new Error(`ics_http_${res.status}`);
    text = await res.text();
  } catch (e) {
    log.info("polls.ics_fetch_failed", { error: e });
    throw new AppError("validation", POLL_ERRORS.icsInvalid, { fieldErrors: { icsUrl: [POLL_ERRORS.icsInvalid] } });
  }
  let parsed: ReturnType<typeof ical.sync.parseICS>;
  try {
    parsed = ical.sync.parseICS(text);
  } catch {
    throw new AppError("validation", POLL_ERRORS.icsInvalid, { fieldErrors: { icsUrl: [POLL_ERRORS.icsInvalid] } });
  }
  const out: Busy[] = [];
  for (const c of Object.values(parsed)) {
    const ev = c as VEvent | undefined;
    if (!ev || ev.type !== "VEVENT") continue;
    if (ev.transparency === "TRANSPARENT" || ev.status === "CANCELLED") continue;
    try {
      for (const i of expandRecurringEvent(ev, { from: range.start, to: range.end, expandOngoing: true })) {
        const s = new Date(i.start).getTime();
        const e = i.end ? new Date(i.end).getTime() : s + (i.isFullDay ? DAY : 0);
        if (e > s) out.push({ start: s, end: e });
      }
    } catch (e) {
      log.info("polls.ics_event_skipped", { error: e });
    }
  }
  return out;
}

/** The signed-in voter's own conflict calendars (titles never leave the server). */
export async function accountBusy(userId: string, range: { start: Date; end: Date }): Promise<Busy[]> {
  const busy = await getExternalBusy({ userIds: [userId], start: range.start, end: range.end });
  return (busy[userId]?.busy ?? []).map((b) => ({ start: b.start.getTime(), end: b.end.getTime() }));
}

// ---------------------------------------------------------------------------------------------------------------
// The browser-side result (signed cookie)

const CHAR: Record<FreeBusyStatus, string> = { busy: "b", free: "f", unknown: "u" };
const BACK: Record<string, FreeBusyStatus> = { b: "busy", f: "free", u: "unknown" };

function optionsHash(ids: readonly string[]): string {
  return createHash("sha256").update([...ids].sort().join(",")).digest("base64url").slice(0, 12);
}

async function sign(payload: string): Promise<string> {
  return createHmac("sha256", await getSecret("session_secret")).update(`poll-freebusy:${payload}`).digest("base64url").slice(0, 22);
}

/** Cookie value for a check: "{pollId}.{optionsHash}.{source}.{epochSeconds}.{statuses}.{mac}". */
export async function encodeCheck(pollId: string, statuses: Record<string, FreeBusyStatus>, source: VoterCalendarCheck["source"], at: Date): Promise<string> {
  const ids = Object.keys(statuses).sort();
  const body = `${pollId}.${optionsHash(ids)}.${source}.${Math.floor(at.getTime() / 1000)}.${ids.map((id) => CHAR[statuses[id]!]).join("")}`;
  return `${body}.${await sign(body)}`;
}

/** The check stored in the cookie, or null when missing, tampered, for another poll or for an older set of options. */
export async function decodeCheck(value: string | null | undefined, pollId: string, optionIds: readonly string[]): Promise<VoterCalendarCheck | null> {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 6) return null;
  const [pid, hash, source, secs, chars, mac] = parts as [string, string, string, string, string, string];
  const body = parts.slice(0, 5).join(".");
  if (!timingSafeEqualStr(await sign(body), mac)) return null;
  if (pid !== pollId || hash !== optionsHash(optionIds)) return null;
  if (!["google", "microsoft", "ics", "account"].includes(source)) return null;
  const ids = [...optionIds].sort();
  if (chars.length !== ids.length) return null;
  const statuses: Record<string, FreeBusyStatus> = {};
  ids.forEach((id, i) => (statuses[id] = BACK[chars[i]!] ?? "unknown"));
  return { source: source as VoterCalendarCheck["source"], checkedAt: new Date(Number(secs) * 1000).toISOString(), statuses };
}

/** The voter page path the result cookie is scoped to. */
function checkCookiePath(slug: string): string {
  return editCookiePaths(slug)[0];
}

/** Appends the result cookie to a hand-built response (route handlers, the OAuth callback redirect). */
export function appendCheckCookie(response: Response, slug: string, value: string, opts: { embed?: boolean } = {}): Response {
  return appendEmbedSafeCookie(response, FREEBUSY_COOKIE, value, { maxAgeSeconds: FREEBUSY_COOKIE_MAX_AGE_SECONDS, path: checkCookiePath(slug), embed: opts.embed });
}

/** Sets the result cookie from a Server Action. */
export async function setCheckCookie(slug: string, value: string, opts: { embed?: boolean } = {}): Promise<void> {
  await setEmbedSafeCookie(FREEBUSY_COOKIE, value, { maxAgeSeconds: FREEBUSY_COOKIE_MAX_AGE_SECONDS, path: checkCookiePath(slug), embed: opts.embed });
}

/** Clears the result cookie ("Clear" next to the calendar check) on a hand-built response. */
export function clearCheckCookie(response: Response, slug: string, opts: { embed?: boolean } = {}): Response {
  return appendEmbedSafeCookie(response, FREEBUSY_COOKIE, "", { maxAgeSeconds: 0, path: checkCookiePath(slug), embed: opts.embed });
}

/** Clears the result cookie from a Server Action. */
export async function deleteCheckCookie(slug: string, opts: { embed?: boolean } = {}): Promise<void> {
  await deleteEmbedSafeCookie(FREEBUSY_COOKIE, { path: checkCookiePath(slug), embed: opts.embed });
}

/** The result cookie of a request (the voter page reads it with readCheckCookieFromHeaders). */
export function readCheckCookie(request: Request | { headers: Headers }): string | null {
  return readEmbedSafeCookie(request, FREEBUSY_COOKIE);
}

/** The result cookie in a Server Component or Server Action (next/headers). */
export async function readCheckCookieFromHeaders(): Promise<string | null> {
  return readEmbedSafeCookieFromHeaders(FREEBUSY_COOKIE);
}
