// Booking notifications (SPEC NT-01 to NT-06, NT-20, CAL-12, CR-06, CR-08, CR-17, MP-19, MP-20, VID-12; docs/SCOPE.md
// priority 5):
//
//   booked       invitee + guests: "Confirmed: ..." with invite.ics (email confirmation mode only; calendar invitation
//                mode: the provider invitation is the confirmation). Every host: "New Event: ..." (cannot be turned
//                off), with an ICS when the host has no writable destination calendar, booked-over alerts, "{n} of
//                {limit} spots filled" (group) and "Booked from meeting poll".
//   rescheduled  invitee + guests (email confirmation mode only): "Updated: ..." with the former time struck through,
//                ICS REQUEST with the same UID and the next SEQUENCE (group: CANCEL of the old UID plus REQUEST).
//                Hosts (every mode): "Rescheduled: ...".
//   canceled     invitee + guests (every mode): "Canceled: ..." with the reason, who canceled and "Schedule again";
//                ICS CANCEL only in email confirmation mode (CAL-12). Hosts: "Canceled: ...". A request to
//                reschedule (CR-08) sends "{Host} would like to reschedule" to the invitee instead; a block (CR-12)
//                hides the reason.
//   moved        in-place moves (MP-21): "Updated" emails with the former time, ICS REQUEST with the new SEQUENCE.
//
// Each email is rendered for its recipient (their zone, time format and locale: buildMeetingTemplateContext) and sent
// with an idempotency key per meeting change and recipient, so a retried job never sends twice. From and Reply-To
// follow NT-20 (meetingSender). Sent emails are recorded on the meeting timeline.
import "server-only";
import { and, eq, gt, lt, ne } from "drizzle-orm";
import type { DB } from "@/db";
import { externalEvents, invitees, scheduledEventHosts, scheduledEvents, users } from "@/db/schema";
import { getDestinationCalendar } from "@/lib/calendars";
import { appName } from "@/lib/brand";
import { conferenceErrorMessage, conferenceProviderName } from "@/lib/conferencing";
import {
  addToCalendarLinks,
  buildMeetingIcs,
  emailBrandForUser,
  icsUid,
  meetingSender,
  sendEmail,
  type EmailBrand,
  type MeetingEmailKind,
  type MeetingIcs,
  type MeetingSender,
  type RenderedEmail,
} from "@/lib/email";
import { sanitizeRichText } from "@/lib/html";
import { getT, intlLocale, resolveLocale } from "@/lib/i18n";
import { log } from "@/lib/logger";
import type { TemplateContext } from "@/lib/template";
import { buildMeetingTemplateContext } from "@/lib/template-context";
import { formatDateLong, formatTime, hour12For } from "@/lib/time/format";
import { zoneOrUtc } from "@/lib/time/zones";
import { absoluteUrl, appHost, inviteeUrls } from "@/lib/url";
import { recordActivity } from "./activity";
import { bookingEmail, calendarFallbackEmail, conferenceFailureEmail, requestRescheduleEmail, type NoticeFacts } from "./emails";
import { activeInvitees, guestsOf, loadMeeting, type InviteeRow, type MeetingBundle, type MeetingHost } from "./load";
import { inviteeMetaOf, meetingMetaOf } from "./types";

type Outgoing = {
  to: string;
  email: RenderedEmail;
  sender: MeetingSender;
  ics?: MeetingIcs | null;
  /** Group reschedules: the CANCEL of the former UID next to the REQUEST. */
  extraIcs?: MeetingIcs | null;
  key: string;
  template: string;
  inviteeId?: string | null;
  userId?: string | null;
};

export const meetingDashboardUrl = (scheduledEventId: string) => absoluteUrl(`/app/meetings?event=${encodeURIComponent(scheduledEventId)}`);

async function deliver(db: DB, b: MeetingBundle, out: Outgoing): Promise<void> {
  const res = await sendEmail({
    to: [out.to],
    subject: out.email.subject,
    html: out.email.html,
    text: out.email.text,
    fromName: out.sender.fromName,
    replyTo: out.sender.replyTo,
    ics: out.ics ? { method: out.ics.method, content: out.ics.content, filename: out.ics.filename } : null,
    attachments: out.extraIcs
      ? [{ filename: "cancel.ics", contentType: `text/calendar; charset=utf-8; method=${out.extraIcs.method}`, content: out.extraIcs.content }]
      : undefined,
    template: out.template,
    category: "transactional",
    idempotencyKey: out.key,
    related: {
      organizationId: b.meeting.organizationId,
      userId: out.userId ?? b.meeting.organizerUserId,
      scheduledEventId: b.meeting.id,
      inviteeId: out.inviteeId ?? undefined,
    },
  });
  if (res.deduplicated) return;
  await recordActivity(db, [
    {
      scheduledEventId: b.meeting.id,
      inviteeId: out.inviteeId ?? null,
      type: res.status === "failed" ? "email_failed" : "email_sent",
      data: { template: out.template, to: out.to, emailOutboxId: res.id, ics: out.ics?.method ?? null },
    },
  ]);
}

const localeOf = (b: MeetingBundle, inv?: InviteeRow | null) => resolveLocale(inv?.locale ?? b.meeting.locale ?? b.meeting.settingsSnapshot?.locale);

/** The invitee-facing ICS of a meeting for one invitee (NT-06, MP-19, MP-20). */
async function inviteeIcs(db: DB, b: MeetingBundle, inv: InviteeRow, method: "REQUEST" | "CANCEL", sequence?: number): Promise<MeetingIcs | null> {
  if (b.poll) {
    // Polls: one shared invite listing everyone (Calendly), or individual invites when invitees are hidden (MP-20).
    if (b.poll.hideInvitees) return buildMeetingIcs({ scheduledEventId: b.meeting.id, inviteeId: inv.id, method, uid: icsUid(inv.id, appHost()), sequence, db });
    return buildMeetingIcs({ scheduledEventId: b.meeting.id, method, manageLinks: false, sequence, locale: inv.locale, db });
  }
  return buildMeetingIcs({ scheduledEventId: b.meeting.id, inviteeId: inv.id, method, sequence, db });
}

/** NT-02: hosts without a writable destination calendar get the event as an ICS. */
async function hostIcs(db: DB, b: MeetingBundle, host: MeetingHost, inv: InviteeRow | null, method: "REQUEST" | "CANCEL", sequence?: number): Promise<MeetingIcs | null> {
  const dest = await getDestinationCalendar(host.userId, b.meeting.eventTypeId).catch(() => null);
  if (dest) return null;
  const perInvitee = inv && !b.meeting.isGroup && !b.poll ? inv.id : null;
  return buildMeetingIcs({ scheduledEventId: b.meeting.id, inviteeId: perInvitee, method, audience: "host", sequence, db });
}

function addToCalendar(b: MeetingBundle, inv: InviteeRow, ctx: TemplateContext, locale: string) {
  const t = getT(locale, "common");
  const title = t("meeting.titleWith", { eventName: b.meeting.name, hostName: String(ctx.my_name ?? "") });
  const urls = inviteeUrls(inv.id);
  return addToCalendarLinks({
    title,
    start: b.meeting.startAt,
    end: b.meeting.endAt,
    location: String(ctx.join_url || ctx.location || "") || null,
    details: urls.confirmation,
    icsUrl: urls.ics,
    locale,
  });
}

const cleanBody = (html: string | null | undefined) => (html?.trim() ? sanitizeRichText(html) || null : null);

/** Booked-over alerts for a host (SCH-13): their other meetings and busy calendar events overlapping this meeting. */
async function overlapsFor(db: DB, b: MeetingBundle, host: MeetingHost): Promise<NonNullable<NoticeFacts["overlaps"]>> {
  const m = b.meeting;
  const zone = zoneOrUtc(host.timezone);
  const hour12 = hour12For(host.timeFormat, "en");
  const meetings = await db
    .select({ name: scheduledEvents.name, startAt: scheduledEvents.startAt })
    .from(scheduledEventHosts)
    .innerJoin(scheduledEvents, eq(scheduledEvents.id, scheduledEventHosts.scheduledEventId))
    .where(
      and(
        eq(scheduledEventHosts.userId, host.userId),
        eq(scheduledEventHosts.isActive, true),
        ne(scheduledEventHosts.scheduledEventId, m.id),
        lt(scheduledEventHosts.startAt, m.endAt),
        gt(scheduledEventHosts.endAt, m.startAt),
      ),
    )
    .limit(3);
  const external = await db
    .select({ title: externalEvents.title, startAt: externalEvents.startAt })
    .from(externalEvents)
    .where(
      and(
        eq(externalEvents.userId, host.userId),
        eq(externalEvents.busy, true),
        eq(externalEvents.isOwn, false),
        eq(externalEvents.allDay, false),
        lt(externalEvents.startAt, m.endAt),
        gt(externalEvents.endAt, m.startAt),
      ),
    )
    .limit(3);
  return [...meetings.map((r) => ({ title: r.name, at: r.startAt })), ...external.map((r) => ({ title: r.title, at: r.startAt }))]
    .slice(0, 3)
    .map((o) => ({ title: o.title?.trim() || null, time: formatTime(o.at, zone, "en", hour12) }));
}

type Prepared = { ctx: TemplateContext; locale: string };

async function inviteeContext(db: DB, scheduledEventId: string, inv: InviteeRow): Promise<Prepared> {
  const ctx = await buildMeetingTemplateContext({ scheduledEventId, inviteeId: inv.id, recipient: "invitee", db });
  return { ctx, locale: resolveLocale(inv.locale) };
}

async function hostContext(db: DB, scheduledEventId: string, inv: InviteeRow | null, host: MeetingHost): Promise<TemplateContext> {
  return buildMeetingTemplateContext({ scheduledEventId, inviteeId: inv?.id ?? null, recipient: "host", hostUserId: host.userId, locale: "en", db });
}

/** Host emails of meetings with several invitees (polls): every invitee in the Invitee field. */
function pollHostCtx(ctx: TemplateContext, list: InviteeRow[]): TemplateContext {
  if (list.length <= 1) return ctx;
  return { ...ctx, invitee_full_name: list.map((i) => `${i.name} (${i.email})`).join(", "), invitee_email: "", guests: "", questions_and_answers: "" };
}

function factsFor(b: MeetingBundle, host: MeetingHost | null): NoticeFacts {
  return {
    spots: b.meeting.isGroup && host ? { filled: activeInvitees(b).length, limit: b.meeting.inviteesLimit } : null,
    assigned: host?.role === "assigned",
    pollTitle: b.poll?.title ?? null,
    fromCalendar: host ? meetingMetaOf(b.meeting.metadata).origin === "calendar_sync" : false,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Booked (NT-01, NT-02)

async function sendBooked(db: DB, b: MeetingBundle, inv: InviteeRow, brand: EmailBrand): Promise<void> {
  const m = b.meeting;
  const snap = m.settingsSnapshot;
  const emailMode = snap.notificationMode === "email_confirmation";
  if (emailMode) {
    const { ctx, locale } = await inviteeContext(db, m.id, inv);
    const ics = await inviteeIcs(db, b, inv, "REQUEST");
    const sender = await meetingSender({ hostUserId: m.organizerUserId, audience: "invitee", db });
    const common = {
      brand,
      locale,
      location: m.location,
      includeAnswers: snap.includeAnswersInNotifications !== false,
      addToCalendar: addToCalendar(b, inv, ctx, locale),
      subjectTemplate: snap.templates?.confirmationSubject ?? null,
      bodyTemplate: cleanBody(snap.templates?.confirmationBody),
      facts: { pollTitle: b.poll?.title ?? null },
    };
    await deliver(db, b, {
      to: inv.email,
      email: bookingEmail("invitee_confirmation", { ...common, ctx, questions: inv.questionsAndAnswers, manageLinks: snap.includeCancelRescheduleLinks !== false }),
      sender,
      ics,
      key: `lc:booked:${inv.id}:invitee`,
      template: "lifecycle.invitee_confirmation",
      inviteeId: inv.id,
    });
    for (const g of guestsOf(b, inv.id)) {
      await deliver(db, b, {
        to: g.email,
        email: bookingEmail("guest_confirmation", { ...common, ctx: { ...ctx, invitee_first_name: "" }, questions: null, manageLinks: false }),
        sender,
        ics,
        key: `lc:booked:${inv.id}:guest:${g.emailNormalized}`,
        template: "lifecycle.guest_confirmation",
        inviteeId: inv.id,
      });
    }
  }
  const list = activeInvitees(b);
  // Several invitees booked at once (polls): one host email for the meeting.
  const shared = Boolean(b.poll) && list.length > 1;
  if (shared && inv.id !== list[0]!.id) return;
  for (const host of b.hosts.filter((h) => h.isActive)) {
    const ctx = await hostContext(db, m.id, inv, host);
    const facts = { ...factsFor(b, host), overlaps: await overlapsFor(db, b, host) };
    await deliver(db, b, {
      to: host.email,
      email: bookingEmail("host_new_event", {
        ctx: shared ? pollHostCtx(ctx, list) : ctx,
        brand,
        locale: "en",
        location: m.location,
        questions: shared ? null : inv.questionsAndAnswers,
        includeAnswers: snap.includeAnswersInNotifications !== false,
        meetingUrl: meetingDashboardUrl(m.id),
        facts,
      }),
      sender: await meetingSender({ hostUserId: m.organizerUserId, audience: "host", replyTo: shared ? null : inv.email, db }),
      ics: await hostIcs(db, b, host, inv, "REQUEST"),
      key: shared ? `lc:booked:${m.id}:host:${host.userId}` : `lc:booked:${inv.id}:host:${host.userId}`,
      template: "lifecycle.host_new_event",
      inviteeId: inv.id,
      userId: host.userId,
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Rescheduled (NT-04)

async function sendRescheduled(db: DB, b: MeetingBundle, inv: InviteeRow, brand: EmailBrand): Promise<void> {
  const m = b.meeting;
  const snap = m.settingsSnapshot;
  const [old] = inv.oldInviteeId ? await db.select().from(invitees).where(eq(invitees.id, inv.oldInviteeId)).limit(1) : [];
  if (!old) return sendBooked(db, b, inv, brand);
  const oldMeeting = await loadMeeting(db, old.scheduledEventId);
  if (!oldMeeting) return sendBooked(db, b, inv, brand);
  const reason = old.rescheduleReason ?? old.cancelReason ?? null;
  const emailMode = snap.notificationMode === "email_confirmation";
  if (emailMode) {
    const { ctx, locale } = await inviteeContext(db, m.id, inv);
    const formerCtx = await buildMeetingTemplateContext({ scheduledEventId: old.scheduledEventId, inviteeId: old.id, recipient: "invitee", db });
    const ics = await inviteeIcs(db, b, inv, "REQUEST");
    // Group variant (CR-10): the former seat had its own UID, which is canceled next to the new invite.
    const groupMove = m.isGroup || oldMeeting.meeting.isGroup;
    const extraIcs = groupMove
      ? await buildMeetingIcs({
          scheduledEventId: old.scheduledEventId,
          inviteeId: old.id,
          method: "CANCEL",
          sequence: oldMeeting.meeting.icsSequence + 1,
          db,
        })
      : null;
    const sender = await meetingSender({ hostUserId: m.organizerUserId, audience: "invitee", db });
    const common = {
      brand,
      locale,
      location: m.location,
      includeAnswers: snap.includeAnswersInNotifications !== false,
      addToCalendar: addToCalendar(b, inv, ctx, locale),
      former: { ctx: formerCtx, reason },
    };
    await deliver(db, b, {
      to: inv.email,
      email: bookingEmail("invitee_rescheduled", { ...common, ctx, questions: inv.questionsAndAnswers, manageLinks: snap.includeCancelRescheduleLinks !== false }),
      sender,
      ics,
      extraIcs,
      key: `lc:resched:${inv.id}:invitee`,
      template: "lifecycle.invitee_rescheduled",
      inviteeId: inv.id,
    });
    for (const g of guestsOf(b, inv.id)) {
      await deliver(db, b, {
        to: g.email,
        email: bookingEmail("guest_rescheduled", {
          ...common,
          ctx: { ...ctx, invitee_first_name: "" },
          former: { ctx: { ...formerCtx, invitee_first_name: "" }, reason },
          questions: null,
          manageLinks: false,
        }),
        sender,
        ics,
        extraIcs,
        key: `lc:resched:${inv.id}:guest:${g.emailNormalized}`,
        template: "lifecycle.guest_rescheduled",
        inviteeId: inv.id,
      });
    }
  }
  const oldHostIds = new Set(oldMeeting.hosts.map((h) => h.userId));
  for (const host of b.hosts.filter((h) => h.isActive)) {
    const ctx = await hostContext(db, m.id, inv, host);
    const sender = await meetingSender({ hostUserId: m.organizerUserId, audience: "host", replyTo: inv.email, db });
    const ics = await hostIcs(db, b, host, inv, "REQUEST");
    if (!oldHostIds.has(host.userId)) {
      // Round robin reassignment through the reschedule: the new host gets a new event email (NT-04).
      await deliver(db, b, {
        to: host.email,
        email: bookingEmail("host_new_event", { ctx, brand, locale: "en", location: m.location, questions: inv.questionsAndAnswers, meetingUrl: meetingDashboardUrl(m.id), facts: factsFor(b, host) }),
        sender,
        ics,
        key: `lc:resched:${inv.id}:host:${host.userId}`,
        template: "lifecycle.host_new_event",
        inviteeId: inv.id,
        userId: host.userId,
      });
      continue;
    }
    const formerCtx = await buildMeetingTemplateContext({ scheduledEventId: old.scheduledEventId, inviteeId: old.id, recipient: "host", hostUserId: host.userId, locale: "en", db });
    await deliver(db, b, {
      to: host.email,
      email: bookingEmail("host_rescheduled", {
        ctx,
        brand,
        locale: "en",
        location: m.location,
        questions: inv.questionsAndAnswers,
        includeAnswers: snap.includeAnswersInNotifications !== false,
        meetingUrl: meetingDashboardUrl(m.id),
        former: { ctx: formerCtx, reason },
        facts: factsFor(b, host),
      }),
      sender,
      ics,
      key: `lc:resched:${inv.id}:host:${host.userId}`,
      template: "lifecycle.host_rescheduled",
      inviteeId: inv.id,
      userId: host.userId,
    });
  }
  // Hosts of the former meeting who no longer host it get a cancellation (round robin reassignment, NT-04).
  for (const host of oldMeeting.hosts.filter((h) => !b.hosts.some((n) => n.userId === h.userId))) {
    const ctx = await hostContext(db, old.scheduledEventId, old, host);
    await deliver(db, oldMeeting, {
      to: host.email,
      email: bookingEmail("host_canceled", { ctx, brand, locale: "en", meetingUrl: meetingDashboardUrl(old.scheduledEventId), cancellation: { canceledBy: old.canceledByName ?? null, reason } }),
      sender: await meetingSender({ hostUserId: oldMeeting.meeting.organizerUserId, audience: "host", replyTo: old.email, db }),
      ics: await hostIcs(db, oldMeeting, host, old, "CANCEL", oldMeeting.meeting.icsSequence + 1),
      key: `lc:resched:${inv.id}:former-host:${host.userId}`,
      template: "lifecycle.host_canceled",
      inviteeId: old.id,
      userId: host.userId,
    });
  }
}

/**
 * Sends the notifications of the meeting's current invitees (booked or rescheduled into it), idempotently: invitees
 * that already got theirs are skipped by their idempotency keys. Called after provisioning (and after a fallback).
 */
export async function notifyMeeting(db: DB, scheduledEventId: string, opts: { inviteeIds?: string[] } = {}): Promise<void> {
  const b = await loadMeeting(db, scheduledEventId);
  if (!b || b.meeting.status !== "active") return;
  const brand = await emailBrandForUser(b.meeting.organizerUserId, db);
  const list = activeInvitees(b).filter((i) => !opts.inviteeIds || opts.inviteeIds.includes(i.id));
  for (const inv of list) {
    try {
      if (inv.oldInviteeId) await sendRescheduled(db, b, inv, brand);
      else await sendBooked(db, b, inv, brand);
    } catch (e) {
      log.error("lifecycle.notify_failed", { scheduledEventId, inviteeId: inv.id, error: e });
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Canceled (NT-03, CR-06, CR-08, CR-12, CR-17)

async function cancelerName(db: DB, b: MeetingBundle, inv: InviteeRow): Promise<string | null> {
  if (inv.canceledByName?.trim()) return inv.canceledByName.trim();
  if (inv.cancelerType === "invitee") return inv.name;
  if (inv.canceledByUserId) {
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, inv.canceledByUserId)).limit(1);
    if (u?.name) return u.name;
  }
  if (inv.cancelerType === "host") return b.organizer?.name ?? null;
  return appName();
}

export async function notifyCanceled(db: DB, p: { scheduledEventId: string; inviteeId: string; meetingCanceled: boolean }): Promise<void> {
  const b = await loadMeeting(db, p.scheduledEventId);
  const inv = b?.invitees.find((i) => i.id === p.inviteeId);
  if (!b || !inv || inv.status !== "canceled" || inv.rescheduled) return;
  const meta = inviteeMetaOf(inv.metadata);
  if (meta.notify === false) return;
  const m = b.meeting;
  const snap = m.settingsSnapshot;
  const brand = await emailBrandForUser(m.organizerUserId, db);
  const emailMode = snap.notificationMode === "email_confirmation";
  const by = await cancelerName(db, b, inv);
  const reason = meta.cancelKind === "blocked" ? null : inv.cancelReason;
  const cancellation = { canceledBy: by, reason };
  // The CANCEL keeps the UID with the next SEQUENCE (one-on-one: stored on the meeting by the cancel; group seats and
  // poll invitees leaving a meeting that goes on: the next number of the meeting's sequence).
  const sequence = p.meetingCanceled && !m.isGroup ? m.icsSequence : m.icsSequence + 1;
  const ics = emailMode ? await inviteeIcs(db, b, inv, "CANCEL", sequence) : null;
  const { ctx, locale } = await inviteeContext(db, m.id, inv);
  const sender = await meetingSender({ hostUserId: m.organizerUserId, audience: "invitee", db });
  const request = meta.cancelKind === "request_reschedule" ? meta.requestReschedule : null;
  if (request) {
    await deliver(db, b, {
      to: inv.email,
      email: requestRescheduleEmail({ ctx, brand, locale, message: request.message, rebookUrl: inviteeUrls(inv.id).reschedule }),
      sender,
      ics,
      key: `lc:request:${inv.id}`,
      template: "lifecycle.request_reschedule",
      inviteeId: inv.id,
    });
  } else {
    await deliver(db, b, {
      to: inv.email,
      email: bookingEmail("invitee_canceled", {
        ctx,
        brand,
        locale,
        cancellation,
        manageLinks: snap.includeCancelRescheduleLinks !== false,
        subjectTemplate: snap.templates?.cancellationSubject ?? null,
        bodyTemplate: cleanBody(snap.templates?.cancellationBody),
      }),
      sender,
      ics,
      key: `lc:cancel:${inv.id}:invitee`,
      template: "lifecycle.invitee_canceled",
      inviteeId: inv.id,
    });
  }
  for (const g of guestsOf(b, inv.id, { includeCanceled: true })) {
    await deliver(db, b, {
      to: g.email,
      email: bookingEmail("guest_canceled", { ctx: { ...ctx, invitee_first_name: "" }, brand, locale, cancellation, manageLinks: false }),
      sender,
      ics,
      key: `lc:cancel:${inv.id}:guest:${g.emailNormalized}`,
      template: "lifecycle.guest_canceled",
      inviteeId: inv.id,
    });
  }
  const whole = p.meetingCanceled && meetingMetaOf(m.metadata).canceledAsWhole === true;
  const list = b.invitees.filter((i) => i.status === "canceled" && !i.rescheduled);
  if (whole && list.length > 1 && inv.id !== list[0]!.id) return; // one host email for the whole meeting
  for (const host of b.hosts) {
    const hctx = await hostContext(db, m.id, inv, host);
    await deliver(db, b, {
      to: host.email,
      email: bookingEmail("host_canceled", {
        ctx: whole && list.length > 1 ? pollHostCtx(hctx, list) : hctx,
        brand,
        locale: "en",
        meetingUrl: meetingDashboardUrl(m.id),
        cancellation: { canceledBy: by, reason: inv.cancelReason },
        facts: { fromCalendar: meta.cancelKind === "calendar", spots: m.isGroup && !p.meetingCanceled ? { filled: activeInvitees(b).length, limit: m.inviteesLimit } : null },
      }),
      sender: await meetingSender({ hostUserId: m.organizerUserId, audience: "host", replyTo: inv.email, db }),
      ics: await hostIcs(db, b, host, inv, "CANCEL", sequence),
      key: whole && list.length > 1 ? `lc:cancel:${m.id}:host:${host.userId}` : `lc:cancel:${inv.id}:host:${host.userId}`,
      template: "lifecycle.host_canceled",
      inviteeId: inv.id,
      userId: host.userId,
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Moved in place (MP-21)

/** The recipient's context with the event times replaced by the former ones (in-place moves keep one row). */
function formerOf(ctx: TemplateContext, from: { start: Date; end: Date }, zone: string, locale: string, timeFormat: string | null): TemplateContext {
  const intl = intlLocale(resolveLocale(locale));
  const hour12 = hour12For(timeFormat, locale);
  const z = zoneOrUtc(zone);
  return {
    ...ctx,
    event_date: formatDateLong(from.start, z, intl),
    event_time: formatTime(from.start, z, intl, hour12),
    event_end_time: formatTime(from.end, z, intl, hour12),
  };
}

export async function notifyMoved(db: DB, p: { scheduledEventId: string; fromStart: Date; fromEnd: Date; sequence: number }): Promise<void> {
  const b = await loadMeeting(db, p.scheduledEventId);
  if (!b || b.meeting.status !== "active" || b.meeting.icsSequence !== p.sequence) return; // a later move supersedes this one
  const m = b.meeting;
  const snap = m.settingsSnapshot;
  const brand = await emailBrandForUser(m.organizerUserId, db);
  const from = { start: p.fromStart, end: p.fromEnd };
  const organizerZone = b.organizer?.timezone ?? "UTC";
  const list = activeInvitees(b);
  if (snap.notificationMode === "email_confirmation") {
    for (const inv of list) {
      const { ctx, locale } = await inviteeContext(db, m.id, inv);
      const formerCtx = formerOf(ctx, from, inv.timezone ?? organizerZone, locale, inv.timeFormat);
      const ics = await inviteeIcs(db, b, inv, "REQUEST");
      const sender = await meetingSender({ hostUserId: m.organizerUserId, audience: "invitee", db });
      const common = { brand, locale, location: m.location, includeAnswers: snap.includeAnswersInNotifications !== false, addToCalendar: addToCalendar(b, inv, ctx, locale) };
      await deliver(db, b, {
        to: inv.email,
        email: bookingEmail("invitee_rescheduled", { ...common, ctx, former: { ctx: formerCtx, reason: null }, questions: inv.questionsAndAnswers, manageLinks: snap.includeCancelRescheduleLinks !== false }),
        sender,
        ics,
        key: `lc:moved:${m.id}:${p.sequence}:${inv.id}:invitee`,
        template: "lifecycle.invitee_rescheduled",
        inviteeId: inv.id,
      });
      for (const g of guestsOf(b, inv.id)) {
        await deliver(db, b, {
          to: g.email,
          email: bookingEmail("guest_rescheduled", { ...common, ctx: { ...ctx, invitee_first_name: "" }, former: { ctx: { ...formerCtx, invitee_first_name: "" }, reason: null }, questions: null, manageLinks: false }),
          sender,
          ics,
          key: `lc:moved:${m.id}:${p.sequence}:${inv.id}:guest:${g.emailNormalized}`,
          template: "lifecycle.guest_rescheduled",
          inviteeId: inv.id,
        });
      }
    }
  }
  const first = list[0] ?? null;
  for (const host of b.hosts.filter((h) => h.isActive)) {
    const ctx = await hostContext(db, m.id, first, host);
    const shown = list.length > 1 ? pollHostCtx(ctx, list) : ctx;
    await deliver(db, b, {
      to: host.email,
      email: bookingEmail("host_rescheduled", {
        ctx: shown,
        brand,
        locale: "en",
        location: m.location,
        questions: list.length === 1 ? first!.questionsAndAnswers : null,
        meetingUrl: meetingDashboardUrl(m.id),
        former: { ctx: formerOf(shown, from, host.timezone, "en", host.timeFormat), reason: null },
        facts: factsFor(b, host),
      }),
      sender: await meetingSender({ hostUserId: m.organizerUserId, audience: "host", replyTo: list.length === 1 ? first!.email : null, db }),
      ics: await hostIcs(db, b, host, list.length === 1 ? first : null, "REQUEST"),
      key: `lc:moved:${m.id}:${p.sequence}:host:${host.userId}`,
      template: "lifecycle.host_rescheduled",
      userId: host.userId,
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// CR-08 reminder, VID-12 conference failure, CAL-12 fallback notice

export async function sendRequestRescheduleReminder(db: DB, inviteeId: string, days: number): Promise<"sent" | "skipped"> {
  const [inv] = await db.select().from(invitees).where(eq(invitees.id, inviteeId)).limit(1);
  if (!inv) return "skipped";
  const request = inviteeMetaOf(inv.metadata).requestReschedule;
  if (!request || request.rebookedInviteeId || inv.newInviteeId || inv.status !== "canceled") return "skipped";
  // Booked again on their own (the public page) since the request: no reminder (CR-08 acceptance).
  const again = await db
    .select({ id: invitees.id })
    .from(invitees)
    .innerJoin(scheduledEvents, eq(scheduledEvents.id, invitees.scheduledEventId))
    .where(
      and(
        eq(invitees.emailNormalized, inv.emailNormalized),
        eq(invitees.eventTypeId, inv.eventTypeId),
        eq(invitees.status, "active"),
        gt(invitees.createdAt, new Date(request.requestedAt)),
      ),
    )
    .limit(1);
  if (again.length) return "skipped";
  const b = await loadMeeting(db, inv.scheduledEventId);
  if (!b) return "skipped";
  const brand = await emailBrandForUser(b.meeting.organizerUserId, db);
  const { ctx, locale } = await inviteeContext(db, b.meeting.id, inv);
  await deliver(db, b, {
    to: inv.email,
    email: requestRescheduleEmail({ ctx, brand, locale, message: request.message, rebookUrl: inviteeUrls(inv.id).reschedule, reminder: true }),
    sender: await meetingSender({ hostUserId: b.meeting.organizerUserId, audience: "invitee", db }),
    key: `lc:request-reminder:${inv.id}:${days}`,
    template: "lifecycle.request_reschedule_reminder",
    inviteeId: inv.id,
  });
  return "sent";
}

/** VID-12: the organizer learns once that the conference link could not be created. */
export async function sendConferenceFailure(db: DB, scheduledEventId: string): Promise<void> {
  const b = await loadMeeting(db, scheduledEventId);
  if (!b || b.meeting.status !== "active" || b.meeting.location?.status !== "failed" || !b.organizer) return;
  const one = activeInvitees(b)[0] ?? null;
  const ctx = await hostContext(db, scheduledEventId, one, b.organizer);
  const kind = b.meeting.location.kind;
  await deliver(db, b, {
    to: b.organizer.email,
    email: conferenceFailureEmail({
      ctx,
      brand: await emailBrandForUser(b.meeting.organizerUserId, db),
      provider: conferenceProviderName(kind) ?? "web conferencing",
      problem: conferenceErrorMessage(b.meeting.location.error, kind),
      meetingUrl: meetingDashboardUrl(scheduledEventId),
    }),
    sender: await meetingSender({ hostUserId: b.meeting.organizerUserId, audience: "host", db }),
    key: `lc:conference-failed:${scheduledEventId}:${b.meeting.location.configId ?? "none"}:${b.meeting.icsSequence}`,
    template: "lifecycle.conference_failure",
    userId: b.organizer.userId,
  });
}

/** CAL-12: the organizer learns that the invitee got the app's confirmation instead of a calendar invitation. */
export async function sendFallbackNotice(db: DB, scheduledEventId: string): Promise<void> {
  const b = await loadMeeting(db, scheduledEventId);
  if (!b || !b.organizer) return;
  const one = activeInvitees(b)[0] ?? null;
  const ctx = await hostContext(db, scheduledEventId, one, b.organizer);
  await deliver(db, b, {
    to: b.organizer.email,
    email: calendarFallbackEmail({
      ctx,
      brand: await emailBrandForUser(b.meeting.organizerUserId, db),
      meetingUrl: meetingDashboardUrl(scheduledEventId),
      problem: meetingMetaOf(b.meeting.metadata).provision?.lastError ?? null,
    }),
    sender: await meetingSender({ hostUserId: b.meeting.organizerUserId, audience: "host", db }),
    key: `lc:fallback:${scheduledEventId}:${b.organizer.userId}`,
    template: "lifecycle.calendar_fallback",
    userId: b.organizer.userId,
  });
}
