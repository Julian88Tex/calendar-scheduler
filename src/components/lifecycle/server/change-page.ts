// Shared data of the invitee cancel and reschedule pages (SPEC CR-02, CR-03, CR-05, CR-08, SCH-23, GEN-08). Server only.
//
// The URL's invitee id is a capability: lifecycle-core's getInviteeChangeContext follows the reschedule chain to the
// active invitee, loads the meeting as this invitee may see it (their own seat and guests, never the host's notes) and
// applies the change rules. This loader adds what the pages render: the meeting summary of the details panel (event,
// host, time in the invitee's stored zone and time format, location), the host's branding, the cancellation policy,
// and the "Schedule another event" target (the event type's booking page while it is bookable, else the host's
// landing page).
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { eventTypes, handles } from "@/db/schema";
import type { PublicBranding } from "@/components/public/public-page-shell";
import { getOperatorEmail } from "@/components/public/operator";
import { hostNames, type HostHeader, type HostPerson } from "@/components/booking/lib/hosts";
import { meetingLocation, type MeetingLocationView } from "@/components/booking/lib/locations";
import { getLegalLinks, loadHostProfile, loadPeople } from "@/components/booking/server/host";
import type { BrandHeaderView } from "@/components/booking/types";
import { getInviteeChangeContext, type InviteeChangeContext } from "@/lib/lifecycle";
import { isUuid } from "@/lib/ids";
import { formatMeetingWhen, hour12For } from "@/lib/time/format";
import { friendlyZoneName, isValidTimeZone } from "@/lib/time/zones";
import { changePageState, type BlockedCopy, type ChangeKind } from "../lib/state";

export type MeetingSummaryView = {
  eventName: string;
  color: string;
  host: HostHeader;
  brandHeader: BrandHeaderView;
  hostName: string;
  durationMinutes: number;
  /** ISO UTC. */
  start: string;
  end: string;
  /** The invitee's stored zone (the confirmation page and emails use it too). */
  zone: string;
  zoneName: string;
  hour12: boolean;
  /** "10:00am - 10:30am, Wednesday, October 14, 2026" */
  whenText: string;
  location: MeetingLocationView | null;
  inviteeName: string;
  inviteeEmail: string;
  /** Guests of this invitee who are still invited. */
  guestCount: number;
  /** The meeting or this invitee is canceled (the summary is struck through). */
  canceled: boolean;
};

export type ChangePageShell = {
  branding: PublicBranding;
  ribbon: boolean;
  privacyUrl: string | null;
  operatorEmail: string | null;
};

export type ChangePageView = {
  kind: ChangeKind;
  inviteeId: string;
  summary: MeetingSummaryView;
  shell: ChangePageShell;
  /** null: the form (cancel) or the booking flow (reschedule). */
  blocked: BlockedCopy | null;
  requireReason: boolean;
  cancellationPolicy: string | null;
  /** "Schedule another event": the event type's booking page, else the host's landing page, else null. */
  scheduleAnotherHref: string | null;
  /** CR-08: the host asked for a new time; picking one books again. */
  rebook: boolean;
};

export type ChangePageResult =
  | { state: "not_found" }
  | { state: "redirect"; inviteeId: string }
  | { state: "ok"; view: ChangePageView; ctx: InviteeChangeContext };

/** The booking page of the meeting's event type while it is bookable, else the host's landing page (BK-20). */
export async function scheduleAnotherHref(eventTypeId: string, organizerUserId: string): Promise<string | null> {
  const db = await getDb();
  const [et] = await db
    .select({ slug: eventTypes.slug, ownerUserId: eventTypes.ownerUserId, teamId: eventTypes.teamId, scope: eventTypes.scope, type: eventTypes.type, active: eventTypes.active })
    .from(eventTypes)
    .where(and(eq(eventTypes.id, eventTypeId), isNull(eventTypes.deletedAt)))
    .limit(1);
  if (et && et.type === "standard" && et.scope !== "shared" && et.active) {
    const owner = et.teamId ? eq(handles.teamId, et.teamId) : et.ownerUserId ? eq(handles.userId, et.ownerUserId) : null;
    const [h] = owner ? await db.select({ slug: handles.slug }).from(handles).where(owner).limit(1) : [];
    if (h) return `/${encodeURIComponent(h.slug)}/${encodeURIComponent(et.slug)}`;
  }
  const [landing] = await db.select({ slug: handles.slug }).from(handles).where(eq(handles.userId, organizerUserId)).limit(1);
  return landing ? `/${encodeURIComponent(landing.slug)}` : null;
}

async function summaryOf(ctx: InviteeChangeContext, profile: Awaited<ReturnType<typeof loadHostProfile>>): Promise<MeetingSummaryView> {
  const b = ctx.meeting;
  const m = b.meeting;
  const inv = ctx.invitee;
  const hostIds = b.hosts.map((h) => h.userId);
  const people = await loadPeople(hostIds.length > 0 ? hostIds : [m.organizerUserId]);
  const organizer: HostPerson = people.find((p) => p.id === m.organizerUserId) ?? people[0] ?? { id: m.organizerUserId, name: ctx.host?.name ?? "", avatarUrl: null };
  const header: HostHeader = people.length > 1 ? { variant: "stack", people, extra: 0, label: hostNames(people) } : { variant: "single", person: organizer };
  const hostName = header.variant === "single" ? organizer.name : (hostNames(people) ?? organizer.name);
  const zone = isValidTimeZone(inv.timezone) ? inv.timezone : profile?.timezone && isValidTimeZone(profile.timezone) ? profile.timezone : "UTC";
  const hour12 = hour12For(inv.timeFormat, "en-US");
  const brandHeader: BrandHeaderView = profile?.logoUrl
    ? { kind: "logo", src: profile.logoUrl }
    : header.variant === "single"
      ? { kind: "avatar", src: organizer.avatarUrl, name: organizer.name }
      : null;
  return {
    eventName: m.name,
    color: m.settingsSnapshot?.color ?? "#8247f5",
    host: header,
    brandHeader,
    hostName,
    durationMinutes: m.durationMinutes,
    start: m.startAt.toISOString(),
    end: m.endAt.toISOString(),
    zone,
    zoneName: friendlyZoneName(zone),
    hour12,
    whenText: formatMeetingWhen(m.startAt, m.endAt, zone, "en-US", hour12),
    location: meetingLocation(m.location, { hostName: organizer.name }),
    inviteeName: inv.name,
    inviteeEmail: inv.email,
    guestCount: b.guests.filter((g) => g.inviteeId === inv.id && !g.canceledAt).length,
    canceled: inv.status !== "active" || m.status !== "active",
  };
}

/** The cancel or reschedule page of an invitee id (see the file header). */
export async function loadChangePage(inviteeIdRaw: string, kind: ChangeKind, opts: { now?: Date } = {}): Promise<ChangePageResult> {
  if (!isUuid(inviteeIdRaw)) return { state: "not_found" };
  const ctx = await getInviteeChangeContext(inviteeIdRaw, opts);
  if (!ctx) return { state: "not_found" };
  const hostName = ctx.host?.name ?? "";
  const decision = changePageState(
    kind,
    { requestedInviteeId: ctx.requestedInviteeId, inviteeId: ctx.invitee.id, moved: ctx.moved, cancelBlock: ctx.cancelBlock, rescheduleBlock: ctx.rescheduleBlock },
    hostName,
  );
  if (decision.state === "redirect") return { state: "redirect", inviteeId: decision.inviteeId };
  const m = ctx.meeting.meeting;
  const [profile, legal, operatorEmail, another] = await Promise.all([
    loadHostProfile(m.organizerUserId),
    getLegalLinks(),
    getOperatorEmail(),
    scheduleAnotherHref(m.eventTypeId, m.organizerUserId),
  ]);
  const summary = await summaryOf(ctx, profile);
  const view: ChangePageView = {
    kind,
    inviteeId: ctx.invitee.id,
    summary,
    shell: {
      branding: { primaryColor: profile?.brandColors.primary ?? null, backgroundColor: profile?.brandColors.background ?? null, textColor: profile?.brandColors.text ?? null },
      ribbon: profile?.showBranding ?? true,
      privacyUrl: profile?.privacyUrl ?? legal.privacyUrl,
      operatorEmail,
    },
    blocked: decision.state === "blocked" ? decision.copy : null,
    requireReason: ctx.requireCancelReason,
    cancellationPolicy: ctx.cancellationPolicy,
    scheduleAnotherHref: another,
    rebook: ctx.rebook,
  };
  return { state: "ok", view, ctx };
}
