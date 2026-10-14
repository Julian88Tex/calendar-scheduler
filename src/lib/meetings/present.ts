// Presentation of one meeting on the Meetings page (SPEC MT-02, MT-05, MT-06, MT-07, MT-13, CR-11, CR-13, CR-14):
// turns the database rows of a meeting (loaded in batches by queries.ts) into the MeetingView the client renders.
// Pure (no database, no clock): every input is passed in, so the rules are unit tested directly.
//
//   dayHeading(date, zone, dateFormat)   "Wednesday, October 14, 2026" (or "Wednesday, 14 October 2026" for DD/MM)
//   locationView(location, opts)         the LOCATION block: venue and address, phone, Google Meet with "Join now",
//                                        "Web conferencing details to follow." and the host-facing failure reason
//   presentMeeting(bundle, ctx)          the whole row and its details panel
import type { HostMeetingSummary } from "@/components/lifecycle/types";
import type { eventTypes, inviteeGuests, invitees, scheduledEvents } from "@/db/schema";
import type { ResolvedLocation } from "@/db/types";
import { CONFERENCING_COPY, conferenceErrorMessage, conferenceJoinUrl, conferenceProviderName, isConferenceKind, isConferencePending } from "@/lib/conferencing/kinds";
import { inviteeMetaOf, meetingMetaOf } from "@/lib/lifecycle/types";
import { dtf, toDate, type DateLike } from "@/lib/time/clock";
import { formatNumericDate, formatTimeRange, isoDateInZone } from "@/lib/time/format";
import { friendlyZoneName, isValidTimeZone } from "@/lib/time/zones";
import { fill, MEETINGS_COPY as C } from "./copy";
import type { MeetingHostView, MeetingLocationView, MeetingNotice, MeetingPersonView, MeetingView } from "./types";

export type RawMeeting = typeof scheduledEvents.$inferSelect;
export type RawInvitee = typeof invitees.$inferSelect;
export type RawGuest = typeof inviteeGuests.$inferSelect;
export type RawEventType = Pick<typeof eventTypes.$inferSelect, "id" | "name" | "slug" | "active" | "deletedAt" | "type" | "scope" | "ownerUserId">;

/** A meeting with everything its row and details need (queries.ts loads these in batches). */
export type MeetingBundle = {
  meeting: RawMeeting;
  /** Every invitee row of the meeting, oldest first. */
  invitees: RawInvitee[];
  /** Guests still invited, by invitee id. */
  guestsByInvitee: ReadonlyMap<string, string[]>;
  /** Invitee ids marked as no-shows. */
  noShows: ReadonlySet<string>;
  hosts: MeetingHostView[];
  eventType: (RawEventType & { ownerSlug: string | null }) | null;
  access: "manage" | "view";
  /** The viewer may edit the event type ("Edit Event Type"). */
  canEditEventType: boolean;
  /** Names of users referenced by the rows (cancelers, schedulers, reschedule requesters). */
  userNames: ReadonlyMap<string, string>;
  /** The meeting this one was rescheduled to (its old invitee points at a newer one). */
  rescheduledTo: { eventId: string; start: Date; end: Date } | null;
  /** The meeting this one was rescheduled from. */
  rescheduledFrom: { eventId: string; start: Date; end: Date } | null;
};

export type PresentContext = {
  /** Business clock (ms). */
  now: number;
  zone: string;
  hour12: boolean;
  /** users.date_format: "MM/DD/YYYY" | "DD/MM/YYYY". */
  dateFormat: string;
  /** Event types offered by the "Event Types" filter ("Filter by Event Type"). */
  filterableEventTypeIds: ReadonlySet<string>;
};

const LOCALE = "en-US";
const HTTP_URL = /^https?:\/\/[^\s<>"']+$/i;

const clean = (s: string | null | undefined): string | null => {
  const v = (typeof s === "string" ? s : "").replace(/\r\n?/g, "\n").trim();
  return v ? v : null;
};

/** Date group heading in the viewer's zone: "Wednesday, October 14, 2026" or, for DD/MM/YYYY, "Wednesday, 14 October 2026". */
export function dayHeading(date: DateLike, zone: string, dateFormat: string | null | undefined): string {
  const parts = dtf(LOCALE, { timeZone: zone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).formatToParts(toDate(date));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return dateFormat === "DD/MM/YYYY"
    ? `${get("weekday")}, ${get("day")} ${get("month")} ${get("year")}`
    : `${get("weekday")}, ${get("month")} ${get("day")}, ${get("year")}`;
}

/** "10:00am - 10:30am, Wednesday, October 14, 2026" in the viewer's zone, time format and date format. */
export function whenText(start: Date, end: Date, ctx: Pick<PresentContext, "zone" | "hour12" | "dateFormat">): string {
  return `${formatTimeRange(start, end, ctx.zone, LOCALE, ctx.hour12)}, ${dayHeading(start, ctx.zone, ctx.dateFormat)}`;
}

/** "1 host | 0 non-hosts". */
export function hostsLabel(hosts: number, nonHosts: number): string {
  return `${C.hosts(hosts)} | ${C.nonHosts(nonHosts)}`;
}

/** The LOCATION block (MT-06), or null for a meeting without a location. */
export function locationView(
  loc: ResolvedLocation | null | undefined,
  opts: { meetingId: string; active: boolean; ended: boolean },
): MeetingLocationView | null {
  if (!loc?.kind) return null;
  const text = clean(loc.location);
  const info = clean(loc.additionalInfo);
  const base = { href: null, joinHref: null, problem: null };
  switch (loc.kind) {
    case "physical":
      return { ...base, icon: "pin", text: text ?? "In-person meeting", detail: info };
    case "custom":
      return { ...base, icon: "custom", text: text ?? "Custom location", detail: info, href: text && HTTP_URL.test(text) ? text : null };
    case "ask_invitee":
      return { ...base, icon: "pin", text: text ?? "Your invitee didn't give a location.", detail: info };
    case "inbound_call":
      return { ...base, icon: "phone", text: text ?? "Phone call", detail: "Your invitee will call you.", href: text ? `tel:${text.replace(/[^\d+]/g, "")}` : null };
    case "outbound_call":
      return { ...base, icon: "phone", text: text ?? "Phone call", detail: "You will call your invitee.", href: text ? `tel:${text.replace(/[^\d+]/g, "")}` : null };
    default: {
      if (!isConferenceKind(loc.kind)) return { ...base, icon: "custom", text: text ?? "Custom location", detail: info };
      const provider = conferenceProviderName(loc.kind) ?? "Web conferencing";
      const url = conferenceJoinUrl(loc);
      if (url) {
        const joinable = opts.active && !opts.ended;
        return { ...base, icon: "video", text: provider, detail: url, joinHref: joinable ? `/events/${opts.meetingId}/join` : null };
      }
      if (loc.status === "failed") {
        return { ...base, icon: "video", text: provider, detail: CONFERENCING_COPY.toFollow, problem: conferenceErrorMessage(loc.error, loc.kind) };
      }
      return { ...base, icon: "video", text: provider, detail: isConferencePending(loc) || opts.active ? CONFERENCING_COPY.toFollow : null };
    }
  }
}

/** One line for the CSV "Location" column. */
export function locationText(loc: ResolvedLocation | null | undefined): string {
  if (!loc?.kind) return "";
  if (isConferenceKind(loc.kind)) return conferenceJoinUrl(loc) ?? conferenceProviderName(loc.kind) ?? "";
  return [clean(loc.location), clean(loc.additionalInfo)].filter(Boolean).join(", ").replace(/\n+/g, " ");
}

type Canceler = { type: RawMeeting["cancelerType"]; userId: string | null; name: string | null };

/** "Canceled by Maya Patel (invitee)" pieces: the canceler's name and role, from the stored row. */
export function cancelerOf(c: Canceler, invitee: Pick<RawInvitee, "name"> | null, userNames: ReadonlyMap<string, string>): { name: string | null; role: string | null } {
  const role = c.type === "host" ? C.details.roleHost : c.type === "invitee" ? C.details.roleInvitee : c.type === "system" ? C.details.roleSystem : null;
  const name = clean(c.name) ?? (c.userId ? (userNames.get(c.userId) ?? null) : null) ?? (c.type === "invitee" ? (invitee?.name ?? null) : null);
  return { name, role };
}

function reasonLine(reason: string | null | undefined): string[] {
  const r = clean(reason);
  return r ? [fill(C.details.reasonLabel, { reason: r })] : [];
}

const TRACKING: { key: keyof RawInvitee; label: string }[] = [
  { key: "utmSource", label: C.trackingLabels.utmSource },
  { key: "utmMedium", label: C.trackingLabels.utmMedium },
  { key: "utmCampaign", label: C.trackingLabels.utmCampaign },
  { key: "utmContent", label: C.trackingLabels.utmContent },
  { key: "utmTerm", label: C.trackingLabels.utmTerm },
  { key: "salesforceUuid", label: C.trackingLabels.salesforceUuid },
];

function personOf(i: RawInvitee, b: MeetingBundle): MeetingPersonView {
  const questions = [...(i.questionsAndAnswers ?? [])]
    .sort((a, z) => (a.position ?? 0) - (z.position ?? 0))
    .map((qa) => ({ question: clean(qa.question) ?? "", answer: clean(qa.answer) ?? "" }))
    .filter((qa) => qa.question && qa.answer);
  const tracking = TRACKING.map((t) => ({ label: t.label, value: clean(i[t.key] as string | null) ?? "" })).filter((t) => t.value);
  return {
    id: i.id,
    name: i.name,
    email: i.email,
    status: i.status,
    noShow: b.noShows.has(i.id),
    timeZoneLabel: isValidTimeZone(i.timezone) ? friendlyZoneName(i.timezone) : null,
    questions,
    guests: b.guestsByInvitee.get(i.id) ?? [],
    tracking,
  };
}

/** The invitees a meeting shows: active ones, or (canceled meetings) the canceled people that did not move away. */
export function peopleOf(meeting: Pick<RawMeeting, "status">, rows: readonly RawInvitee[]): RawInvitee[] {
  const active = rows.filter((i) => i.status === "active");
  if (meeting.status === "active") return active;
  const stayed = rows.filter((i) => !i.rescheduled);
  return stayed.length ? stayed : [...rows];
}

/** The lifecycle-ui dialogs' summary (same rules as loadHostMeetingSummary, built from rows already loaded). */
export function summaryOf(b: MeetingBundle, ctx: PresentContext): HostMeetingSummary {
  const m = b.meeting;
  const et = b.eventType;
  const people = b.invitees.filter((i) => !i.rescheduled || i.status === "active");
  return {
    scheduledEventId: m.id,
    eventName: m.name,
    color: m.settingsSnapshot?.color ?? "#8247f5",
    start: m.startAt.toISOString(),
    end: m.endAt.toISOString(),
    durationMinutes: m.durationMinutes,
    status: m.status,
    isGroup: m.isGroup,
    source: m.source,
    eventTypeId: m.eventTypeId,
    eventTypeBookable: Boolean(et && et.active && !et.deletedAt && et.type === "standard"),
    hostCount: b.hosts.length,
    timeZone: ctx.zone,
    hour12: ctx.hour12,
    invitees: people.map((i) => ({
      id: i.id,
      name: i.name,
      email: i.email,
      timezone: isValidTimeZone(i.timezone) ? i.timezone : null,
      status: i.status,
      noShow: b.noShows.has(i.id),
    })),
    notesHtml: m.meetingNotesHtml ?? null,
  };
}

function noticesOf(b: MeetingBundle, ctx: PresentContext, people: RawInvitee[], ended: boolean): MeetingNotice[] {
  const m = b.meeting;
  const out: MeetingNotice[] = [];
  const when = (s: Date, e: Date) => whenText(s, e, ctx);
  const first = people[0] ?? b.invitees[0] ?? null;
  const moved = b.invitees.find((i) => i.rescheduled && i.status === "canceled") ?? null;

  if (m.status === "canceled") {
    if (moved && b.rescheduledTo && !b.invitees.some((i) => i.status === "active")) {
      const who = cancelerOf({ type: moved.cancelerType, userId: moved.canceledByUserId, name: moved.canceledByName }, moved, b.userNames);
      out.push({
        kind: "rescheduled_to",
        tone: "info",
        text: fill(C.details.rescheduledTo, { when: when(b.rescheduledTo.start, b.rescheduledTo.end) }),
        details: [...(who.name ? [`${fill(C.details.rescheduledBy, { name: who.name })}${who.role ? ` (${who.role})` : ""}`] : []), ...reasonLine(moved.rescheduleReason ?? moved.cancelReason)],
        link: { label: C.details.viewNewTime, eventId: b.rescheduledTo.eventId },
      });
    } else {
      const inv = first;
      const request = inv ? inviteeMetaOf(inv.metadata).requestReschedule : null;
      if (inv && request) {
        const by = request.byUserId ? (b.userNames.get(request.byUserId) ?? null) : null;
        out.push({
          kind: "reschedule_requested",
          tone: "info",
          text: by ? fill(C.details.requestedReschedule, { name: by }) : C.details.requestedRescheduleNoName,
          details: request.message ? [fill(C.details.reasonLabel, { reason: request.message })] : [],
          link: null,
        });
      } else {
        // The meeting row holds the whole-meeting cancel; a solo meeting's invitee row holds the same facts.
        const src = m.cancelerType ? { type: m.cancelerType, userId: m.canceledByUserId, name: m.canceledByName } : { type: inv?.cancelerType ?? null, userId: inv?.canceledByUserId ?? null, name: inv?.canceledByName ?? null };
        const who = cancelerOf(src, inv, b.userNames);
        const text = who.name ? fill(C.details.canceledBy, { name: who.name, role: who.role ?? C.details.roleHost }) : C.details.canceledNoName;
        out.push({ kind: "canceled", tone: "danger", text, details: reasonLine(m.cancelReason ?? inv?.cancelReason), link: null });
      }
    }
  }

  if (b.rescheduledFrom) {
    const fromInvitee = people.find((i) => i.oldInviteeId) ?? null;
    out.push({
      kind: "rescheduled_from",
      tone: "neutral",
      text: fill(C.details.rescheduledFrom, { when: when(b.rescheduledFrom.start, b.rescheduledFrom.end) }),
      details: reasonLine(fromInvitee?.rescheduleReason),
      link: { label: C.details.viewFormerTime, eventId: b.rescheduledFrom.eventId },
    });
  }

  if (m.status === "active" && !ended && b.access === "manage") {
    if (m.provisionStatus === "failed") out.push({ kind: "calendar_failed", tone: "danger", text: C.details.calendarFailed, details: [], link: null });
    if (meetingMetaOf(m.metadata).provision?.fallbackAt) out.push({ kind: "calendar_fallback", tone: "info", text: C.details.calendarFallback, details: [], link: null });
  }
  return out;
}

/** The "Schedule Invitee Again" link (CR-13): the event type's booking page prefilled with the invitee. */
export function scheduleAgainHref(et: MeetingBundle["eventType"], person: Pick<RawInvitee, "name" | "email"> | null): string | null {
  if (!et || !person || !et.ownerSlug || et.type !== "standard" || et.scope !== "personal" || !et.active || et.deletedAt) return null;
  const qs = new URLSearchParams({ name: person.name, email: person.email });
  return `/${encodeURIComponent(et.ownerSlug)}/${encodeURIComponent(et.slug)}?${qs.toString()}`;
}

/** The row and details panel of one meeting. */
export function presentMeeting(b: MeetingBundle, ctx: PresentContext): MeetingView {
  const m = b.meeting;
  const ended = m.endAt.getTime() <= ctx.now;
  const active = m.status === "active";
  const manage = b.access === "manage";
  const peopleRows = peopleOf(m, b.invitees);
  const people = peopleRows.map((i) => personOf(i, b));
  const activeCount = b.invitees.filter((i) => i.status === "active").length;
  const rescheduled = !active && b.rescheduledTo !== null && b.invitees.some((i) => i.rescheduled) && activeCount === 0;
  const title = m.isGroup
    ? fill(C.row.invitees, { count: active ? activeCount : peopleRows.length })
    : (peopleRows[0]?.name ?? C.row.noInvitees);
  const guests = people.reduce((n, p) => n + p.guests.length, 0);
  const location = locationView(m.location, { meetingId: m.id, active, ended });
  const et = b.eventType;
  const first = peopleRows[0] ?? null;
  const scheduledBy = first?.scheduledByUserId ? (b.userNames.get(first.scheduledByUserId) ?? null) : null;
  const createdDate = formatNumericDate(m.createdAt, ctx.zone, ctx.dateFormat);
  const createdBy = first?.name ?? null;
  const conferenceFailed = m.location?.status === "failed";
  const canRetry = manage && active && !ended && (conferenceFailed || m.provisionStatus === "failed");
  const shownLocation = location && !manage ? { ...location, problem: null } : location;
  // "Retry" sits with the LOCATION problem when there is one (a Meet link that failed); a calendar write that failed
  // for any other location gets it on its status line.
  const notices = noticesOf(b, ctx, peopleRows, ended).map((n) => (n.kind === "calendar_failed" && canRetry && !shownLocation?.problem ? { ...n, retry: true } : n));
  return {
    id: m.id,
    eventName: m.name,
    color: m.settingsSnapshot?.color ?? "#8247f5",
    start: m.startAt.toISOString(),
    end: m.endAt.toISOString(),
    dateKey: isoDateInZone(m.startAt, ctx.zone),
    timeRange: formatTimeRange(m.startAt, m.endAt, ctx.zone, LOCALE, ctx.hour12),
    when: whenText(m.startAt, m.endAt, ctx),
    status: m.status,
    rescheduled,
    isPoll: m.source === "poll",
    isGroup: m.isGroup,
    title,
    hostsLabel: hostsLabel(b.hosts.length, guests),
    spotsLabel: m.isGroup ? fill(C.row.spots, { count: activeCount, limit: m.inviteesLimit }) : null,
    access: b.access,
    ended,
    people,
    location: shownLocation,
    canRetry,
    hosts: b.hosts,
    notices,
    notesHtml: manage ? (clean(m.meetingNotesHtml) ? m.meetingNotesHtml : null) : null,
    createdLabel: createdBy ? fill(C.details.created, { date: createdDate, name: createdBy }) : fill(C.details.createdNoName, { date: createdDate }),
    scheduledByLabel: scheduledBy ? fill(C.details.scheduledBy, { name: scheduledBy }) : null,
    eventTypeId: m.eventTypeId,
    editEventTypeHref: b.canEditEventType && et && et.type === "standard" && !et.deletedAt ? `/app/event-types/${et.id}` : null,
    canFilterByEventType: ctx.filterableEventTypeIds.has(m.eventTypeId),
    scheduleAgainHref: (!active && !rescheduled) || (active && ended) ? scheduleAgainHref(et, first) : null,
    canReschedule: manage && active && !ended,
    canCancel: manage && active && !ended,
    summary: manage ? summaryOf(b, ctx) : null,
  };
}
