// OWNER: conferencing.
//
// The stable join link /events/{scheduledEventId}/join (SPEC VID-11). Emails, ICS files and confirmation pages link
// here, so the link keeps working while the conference is created and after a reschedule:
//
//   unknown id                     404 "Meeting not found"
//   rescheduled meeting            follows the reschedule chain to the active meeting (the redirect target updates)
//   canceled meeting               404 with "This meeting was canceled."
//   conference with a join URL     302 to the provider URL (https only)
//   conference still being made    200 "Your meeting link is being prepared. This page will refresh automatically."
//                                  (refresh every 5 seconds, up to 2 minutes, then a "Try again" page)
//   conference that failed         200 "Web conferencing details to follow."
//   other locations                200 with the location details (venue and notes, phone, text)
//
// Read only (GET-safe for email link scanners, GEN-08); never calls a provider.
import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { scheduledEvents } from "@/db/schema";
import type { ResolvedLocation } from "@/db/types";
import { escapeHtml as esc } from "@/lib/html";
import { isUuid } from "@/lib/ids";
import { CONFERENCING_COPY, conferenceJoinUrl, conferenceProviderName, isConferenceKind, isConferencePending, isSafeJoinUrl } from "./kinds";

/** Refresh period and attempts of the preparing page (5 seconds, up to 2 minutes). */
export const JOIN_REFRESH_SECONDS = 5;
export const JOIN_MAX_ATTEMPTS = 24;
/** Reschedule hops followed from an old link (a meeting rescheduled more often than this shows as canceled). */
const MAX_HOPS = 10;

export type JoinMeeting = { id: string; name: string; status: "active" | "canceled"; location: ResolvedLocation | null };

export type JoinDetailLine = { text: string; href?: string | null; muted?: boolean };

export type JoinOutcome =
  | { type: "not_found" }
  | { type: "redirect"; url: string }
  | { type: "preparing"; meetingId: string; meetingName: string; provider: string; nextAttempt: number }
  | { type: "preparing_timeout"; meetingId: string; meetingName: string; provider: string }
  | { type: "canceled"; meetingName: string }
  | { type: "no_link"; meetingName: string; provider: string }
  | { type: "details"; meetingName: string; heading: string; lines: JoinDetailLine[] };

/** The meeting behind a join link, following reschedules from canceled meetings to the active one. */
export async function loadJoinMeeting(scheduledEventId: string): Promise<JoinMeeting | null> {
  if (!isUuid(scheduledEventId)) return null;
  const db = await getDb();
  const cols = { id: scheduledEvents.id, name: scheduledEvents.name, status: scheduledEvents.status, location: scheduledEvents.location };
  const [first] = await db.select(cols).from(scheduledEvents).where(eq(scheduledEvents.id, scheduledEventId)).limit(1);
  if (!first) return null;
  let current: JoinMeeting = first;
  const seen = new Set([current.id]);
  for (let hop = 0; hop < MAX_HOPS && current.status === "canceled"; hop++) {
    const [next] = await db
      .select(cols)
      .from(scheduledEvents)
      .where(eq(scheduledEvents.rescheduledFromEventId, current.id))
      .orderBy(desc(scheduledEvents.createdAt))
      .limit(1);
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    current = next;
  }
  return current;
}

const clean = (s: string | null | undefined): string | null => {
  const v = (s ?? "").replace(/\r\n?/g, "\n").trim();
  return v ? v : null;
};

const telHref = (phone: string): string | null => {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.replace(/\+/g, "").length >= 5 ? `tel:${digits}` : null;
};

/** The location details of a meeting that is not a web conference. */
function detailsOf(meeting: JoinMeeting): JoinOutcome {
  const loc = meeting.location;
  const text = clean(loc?.location);
  const info = clean(loc?.additionalInfo);
  const notes: JoinDetailLine[] = info ? [{ text: info, muted: true }] : [];
  switch (loc?.kind) {
    case "physical":
      return { type: "details", meetingName: meeting.name, heading: "In-person meeting", lines: [...(text ? [{ text }] : []), ...notes] };
    case "inbound_call":
    case "outbound_call":
      return {
        type: "details",
        meetingName: meeting.name,
        heading: "Phone call",
        lines: [...(text ? [{ text, href: telHref(text) }] : []), ...(loc.kind === "outbound_call" ? [{ text: "The host will call this number.", muted: true }] : []), ...notes],
      };
    case "ask_invitee":
      return { type: "details", meetingName: meeting.name, heading: "Location", lines: [...(text ? [{ text }] : [{ text: "No location was given for this meeting.", muted: true }]), ...notes] };
    case "custom":
      return {
        type: "details",
        meetingName: meeting.name,
        heading: "Location",
        lines: [...(text ? [{ text, href: isSafeJoinUrl(text) ? text : null }] : []), ...notes],
      };
    default:
      return { type: "details", meetingName: meeting.name, heading: "Location", lines: [{ text: "No location was set for this meeting.", muted: true }] };
  }
}

/** What the join link answers for a meeting (see the file header). `attempt` counts the preparing page refreshes. */
export function decideJoin(meeting: JoinMeeting | null, attempt = 0): JoinOutcome {
  if (!meeting) return { type: "not_found" };
  if (meeting.status === "canceled") return { type: "canceled", meetingName: meeting.name };
  const loc = meeting.location;
  if (!loc?.kind || !isConferenceKind(loc.kind)) return detailsOf(meeting);
  const provider = conferenceProviderName(loc.kind) ?? "Web conference";
  const url = conferenceJoinUrl(loc);
  if (url && loc.status !== "failed") return { type: "redirect", url };
  if (isConferencePending(loc)) {
    const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
    if (n >= JOIN_MAX_ATTEMPTS) return { type: "preparing_timeout", meetingId: meeting.id, meetingName: meeting.name, provider };
    return { type: "preparing", meetingId: meeting.id, meetingName: meeting.name, provider, nextAttempt: n + 1 };
  }
  return { type: "no_link", meetingName: meeting.name, provider };
}

// ---------------------------------------------------------------------------------------------------------------
// HTML (a tiny standalone page: no scripts, no external assets)

const ICONS = {
  video:
    '<path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  canceled: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M10 14l4 4M14 14l-4 4"/>',
  pin: '<path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  phone:
    '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
} as const;

function icon(name: keyof typeof ICONS): string {
  return `<svg class="icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}

const STYLES = `
:root{color-scheme:light;--ink:#0a2540;--ink-2:#476788;--line:#d4e0ed;--primary:#006bff;--primary-hover:#004eba;--canvas:#fafafa}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px 16px;background:var(--canvas);color:var(--ink);font-family:"Figtree Variable","Figtree","Proxima Nova",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:480px;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 1px 8px 0 rgb(0 0 0 / 8%);padding:40px 32px;text-align:center}
.icon{color:var(--ink-2);display:block;margin:0 auto 16px}
.badge{display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:9999px;background:#f4f8ff;margin:0 auto 16px}
.badge .icon{margin:0;color:var(--primary)}
h1{margin:0 0 8px;font-size:20px;line-height:28px;font-weight:700;overflow-wrap:anywhere}
p{margin:0 0 8px;color:var(--ink-2);overflow-wrap:anywhere}
p.lead{color:var(--ink);font-weight:600}
.detail{margin:20px 0 0;padding:16px;border:1px solid var(--line);border-radius:8px;text-align:left;display:flex;gap:12px;align-items:flex-start}
.detail .icon{margin:2px 0 0;flex:none;width:20px;height:20px}
.detail p{margin:0 0 4px;color:var(--ink);white-space:pre-line}
.detail p.muted{color:var(--ink-2);font-size:14px}
.detail p.heading{font-weight:600}
a{color:var(--primary-hover);text-decoration:underline;text-underline-offset:2px}
a:focus-visible{outline:2px solid var(--primary);outline-offset:2px;border-radius:2px}
.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin-top:20px;padding:0 24px;border-radius:9999px;background:var(--primary);color:#fff;font-weight:600;text-decoration:none}
.button:hover{background:var(--primary-hover)}
.spinner{width:28px;height:28px;margin:20px auto 0;border:3px solid #e6f0ff;border-top-color:var(--primary);border-radius:9999px;animation:spin .9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spinner{animation-duration:3s}}
footer{color:var(--ink-2);font-size:12px}
@media (max-width:480px){main{padding:32px 20px}}
`;

function htmlDocument(p: { title: string; body: string; refresh?: { seconds: number; url: string } | null; appName: string }): string {
  const refresh = p.refresh ? `<meta http-equiv="refresh" content="${p.refresh.seconds};url=${esc(p.refresh.url)}">` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">${refresh}<title>${esc(p.title)}</title><style>${STYLES}</style></head><body><main>${p.body}</main><footer>${esc(p.appName)}</footer></body></html>`;
}

function line(l: JoinDetailLine, cls?: string): string {
  const classes = [cls, l.muted ? "muted" : null].filter(Boolean).join(" ");
  const attr = classes ? ` class="${classes}"` : "";
  const text = esc(l.text);
  return `<p${attr}>${l.href ? `<a href="${esc(l.href)}" rel="noopener noreferrer">${text}</a>` : text}</p>`;
}

export type JoinPage = { status: number; html: string };

/** The HTML page of every outcome except the redirect. */
export function renderJoinPage(outcome: Exclude<JoinOutcome, { type: "redirect" }>, opts: { appName: string; path: string }): JoinPage {
  const app = opts.appName;
  switch (outcome.type) {
    case "not_found":
      return {
        status: 404,
        html: htmlDocument({
          appName: app,
          title: "Meeting not found",
          body: `${icon("search")}<h1>Meeting not found</h1><p>This meeting link isn't valid. Check the link in your confirmation email or calendar invitation.</p>`,
        }),
      };
    case "canceled":
      return {
        status: 404,
        html: htmlDocument({
          appName: app,
          title: `Canceled: ${outcome.meetingName}`,
          body: `${icon("canceled")}<h1>${esc(outcome.meetingName)}</h1><p class="lead">${esc(CONFERENCING_COPY.canceled)}</p>`,
        }),
      };
    case "preparing": {
      const next = `${opts.path}?attempt=${outcome.nextAttempt}`;
      return {
        status: 200,
        html: htmlDocument({
          appName: app,
          title: outcome.meetingName,
          refresh: { seconds: JOIN_REFRESH_SECONDS, url: next },
          body: `<span class="badge">${icon("video")}</span><h1>${esc(outcome.meetingName)}</h1><p class="lead" role="status">${esc(CONFERENCING_COPY.preparing)}</p><p>${esc(outcome.provider)}</p><div class="spinner" aria-hidden="true"></div>`,
        }),
      };
    }
    case "preparing_timeout":
      return {
        status: 200,
        html: htmlDocument({
          appName: app,
          title: outcome.meetingName,
          body: `<span class="badge">${icon("video")}</span><h1>${esc(outcome.meetingName)}</h1><p class="lead">Your meeting link isn't ready yet.</p><p>Check your confirmation email or calendar invitation for the ${esc(outcome.provider)} link, or try again in a minute.</p><a class="button" href="${esc(opts.path)}">Try again</a>`,
        }),
      };
    case "no_link":
      return {
        status: 200,
        html: htmlDocument({
          appName: app,
          title: outcome.meetingName,
          body: `<span class="badge">${icon("video")}</span><h1>${esc(outcome.meetingName)}</h1><p class="lead">${esc(CONFERENCING_COPY.toFollow)}</p><p>Your host will share the ${esc(outcome.provider)} details. Check your email or calendar invitation for updates.</p>`,
        }),
      };
    case "details": {
      const kindIcon = outcome.heading === "Phone call" ? "phone" : "pin";
      return {
        status: 200,
        html: htmlDocument({
          appName: app,
          title: outcome.meetingName,
          body: `<h1>${esc(outcome.meetingName)}</h1><p>This meeting doesn't have a web conferencing link.</p><div class="detail">${icon(kindIcon)}<div>${line({ text: outcome.heading }, "heading")}${outcome.lines.map((l) => line(l)).join("")}</div></div>`,
        }),
      };
    }
  }
}
