// Sending meeting poll emails (SPEC MP-06, MP-23, MP-24; research meeting-polls.md B10). Called by the polls job
// handlers only (request code enqueues jobs, ARCHITECTURE 26 rule 9). Every email is rendered for its recipient
// (participants: their zone and the poll's language; hosts: their profile zone, time format and language), sent through
// the shared email core with an idempotency key (a retried job never sends twice), From "{Host} via {AppName}" with
// Reply-To the host for participant emails (NT-20), and every participant notification carries the per-poll unsubscribe
// link plus List-Unsubscribe / List-Unsubscribe-Post (one click). Unsubscribed participants get no invitations,
// reminders or updates (booking invites are lifecycle-core's and always go out). Server only.
import "server-only";
import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import type { DB } from "@/db";
import { invitees, meetingPollActivity, meetingPollComments, meetingPollParticipants, meetingPolls, scheduledEvents, users } from "@/db/schema";
import { DEFAULT_NOTIFICATION_PREFS } from "@/db/types";
import { decrypt } from "@/lib/crypto";
import { emailBrandForUser, meetingSender, renderMeetingEmail, sendEmail, type RenderedEmail } from "@/lib/email";
import { zoneLabel } from "@/lib/i18n";
import { log } from "@/lib/logger";
import { buildMeetingTemplateContext } from "@/lib/template-context";
import { formatDateLong, formatDuration, formatTime, hour12For } from "@/lib/time/format";
import { now as clockNow } from "@/lib/time/now";
import { zoneOrUtc } from "@/lib/time/zones";
import { absoluteUrl } from "@/lib/url";
import { MAX_AUTOMATIC_REMINDERS } from "./constants";
import { commonDuration, optionLongLabel } from "./display";
import {
  commentEmail,
  digestEmail,
  editLinkEmail,
  hostChangedVotesEmail,
  hostStatusEmail,
  invitationEmail,
  othersVotedEmail,
  participantNoticeEmail,
  pollUpdatedEmail,
  reminderEmail,
  verificationCodeEmail,
  voteReceivedEmail,
  voterConfirmationEmail,
  type OptionLine,
} from "./emails/templates";
import { loadOptions, loadParticipants, loadPoll, loadPollHosts, loadVotes, startOf, statusOf, votesByParticipant, type OptionRow, type ParticipantRow, type PollHostRow, type PollRow } from "./load";
import { isRespondent, rankPollOptions } from "./ranking";
import { editLink, inviteLink, unsubscribePageUrl, unsubscribePostUrl } from "./tokens";
import { visibilityFlags } from "./visibility";
import type { VoteChoice } from "./types";

type Recipient = { email: string; zone: string; locale: string; hour12: boolean };

const resultsUrl = (pollId: string) => absoluteUrl(`/app/polls/${encodeURIComponent(pollId)}`);
const bookUrl = (pollId: string, optionId: string) => absoluteUrl(`/app/polls/${encodeURIComponent(pollId)}?book=${encodeURIComponent(optionId)}`);

function optionLike(o: OptionRow) {
  return { start: o.startsAt?.toISOString() ?? null, end: o.endsAt?.toISOString() ?? null, allDayDate: o.allDayDate, durationMinutes: o.durationMinutes };
}

function line(o: OptionRow, r: Recipient, extra: Partial<OptionLine> = {}): OptionLine {
  return { label: optionLongLabel(optionLike(o), r.zone, { locale: r.locale, hour12: r.hour12 }), ...extra };
}

function whenLabel(at: Date, r: Recipient): string {
  return `${formatDateLong(at, r.zone, r.locale)}, ${formatTime(at, r.zone, r.locale, r.hour12)} (${zoneLabel(r.zone, r.locale)})`;
}

function participantRecipient(p: Pick<ParticipantRow, "email" | "timezone">, poll: PollRow): Recipient | null {
  if (!p.email) return null;
  const zone = zoneOrUtc(poll.timeZoneMode === "fixed" ? poll.timezone : (p.timezone ?? poll.timezone));
  return { email: p.email, zone, locale: poll.locale, hour12: hour12For(null, poll.locale) };
}

function hostRecipient(h: Pick<PollHostRow, "email" | "timezone" | "timeFormat" | "locale">): Recipient {
  return { email: h.email, zone: zoneOrUtc(h.timezone), locale: h.locale || "en", hour12: hour12For(h.timeFormat, h.locale || "en") };
}

async function ownerName(db: DB, poll: PollRow): Promise<string> {
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, poll.ownerUserId)).limit(1);
  return u?.name ?? "";
}

async function deliver(
  db: DB,
  poll: PollRow,
  p: { to: string; email: RenderedEmail; template: string; key: string; audience: "invitee" | "host"; participantId?: string | null; userId?: string | null; unsubscribe?: string | null },
): Promise<void> {
  const sender = await meetingSender({ hostUserId: poll.ownerUserId, audience: p.audience, db });
  await sendEmail({
    to: [p.to],
    subject: p.email.subject,
    html: p.email.html,
    text: p.email.text,
    fromName: sender.fromName,
    replyTo: sender.replyTo,
    template: `polls.${p.template}`,
    category: "poll",
    idempotencyKey: p.key,
    listUnsubscribe: p.unsubscribe ? { url: p.unsubscribe } : null,
    related: { organizationId: poll.organizationId, pollId: poll.id, userId: p.userId ?? poll.ownerUserId },
  });
}

/** The top times (at most 3 future options with at least one Yes or If need be) for summaries. */
function topLines(poll: PollRow, options: OptionRow[], participants: ParticipantRow[], votes: ReturnType<typeof votesByParticipant>, r: Recipient, now: Date, n = 3): OptionLine[] {
  const flat = [...votes.entries()].flatMap(([participantId, v]) => Object.entries(v).map(([optionId, choice]) => ({ participantId, optionId, choice })));
  const ranked = rankPollOptions(options.map((o) => ({ id: o.id, start: startOf(o, poll.timezone) })), flat, participants.map((p) => ({ id: p.id, status: p.status, isRequired: p.isRequired })), [], now);
  const byId = new Map(options.map((o) => [o.id, o]));
  return ranked
    .filter((x) => !x.isPast && x.attendable > 0)
    .slice(0, n)
    .map((x) => line(byId.get(x.id)!, r, { counts: { yes: x.yes, ifNeedBe: x.ifNeedBe } }));
}

/**
 * The "{x} of {y} responded" total: every participant (respondents plus invited people who haven't answered) once
 * anyone was invited by email, else null ("{x} responses").
 */
function responseTotal(participants: readonly Pick<ParticipantRow, "source">[]): number | null {
  return participants.some((p) => p.source === "invite") ? participants.length : null;
}

function futureOptions(poll: PollRow, options: OptionRow[], now: Date): OptionRow[] {
  return options.filter((o) => startOf(o, poll.timezone) > now.getTime()).sort((a, b) => startOf(a, poll.timezone) - startOf(b, poll.timezone));
}

function durationLabel(options: OptionRow[]): string | null {
  const d = commonDuration(options.map((o) => ({ durationMinutes: o.durationMinutes, allDayDate: o.allDayDate })));
  if (d === null) return null;
  return options.every((o) => o.allDayDate) ? "All day" : formatDuration(d);
}

// ---------------------------------------------------------------------------------------------------------------
// polls.email (one templated email)

export type PollEmailPayload = {
  template: string;
  pollId: string;
  participantId?: string | null;
  userId?: string | null;
  email?: string | null;
  data?: Record<string, unknown>;
  key: string;
};

/** Renders and sends one templated email (job polls.email). Returns false when it no longer applies. */
export async function sendPollEmail(db: DB, p: PollEmailPayload): Promise<boolean> {
  const poll = await loadPoll(db, p.pollId);
  if (!poll) return false;
  // A deleted poll only sends its "{Host} canceled the poll" notice: queued invitations, confirmations, magic links,
  // codes and other notices would point at a link that answers 410.
  if ((poll.deletedAt || poll.status === "canceled") && p.template !== "canceled") return false;
  const now = clockNow();
  const brand = await emailBrandForUser(poll.ownerUserId, db);
  const hostName = await ownerName(db, poll);
  const base = { brand, title: poll.title, hostName };

  // Host emails.
  if (p.template === "auto_booked") {
    const hosts = await loadPollHosts(db, poll);
    const owner = hosts.find((h) => h.role === "owner");
    if (!owner) return false;
    const r = hostRecipient(owner);
    const options = await loadOptions(db, poll.id, { includeDeleted: true });
    const o = options.find((x) => x.id === p.data?.optionId);
    const email = hostStatusEmail({ ...base, locale: r.locale, kind: "autoBooked", when: o ? line(o, r).label : null, respondents: 0, invited: null, top: null, url: absoluteUrl(`/app/meetings?event=${encodeURIComponent(String(p.data?.scheduledEventId ?? ""))}`) });
    await deliver(db, poll, { to: r.email, email, template: "auto_booked", key: p.key, audience: "host", userId: owner.userId });
    return true;
  }

  // Emails to an address without a participant row (verification codes).
  if (p.template === "verification_code") {
    if (!p.email || typeof p.data?.codeEnc !== "string") return false;
    const code = await decrypt(p.data.codeEnc);
    const email = verificationCodeEmail({ ...base, locale: poll.locale, code });
    await deliver(db, poll, { to: p.email, email, template: "verification_code", key: p.key, audience: "invitee" });
    return true;
  }

  if (!p.participantId) return false;
  const [participant] = await db.select().from(meetingPollParticipants).where(eq(meetingPollParticipants.id, p.participantId)).limit(1);
  if (!participant || participant.pollId !== poll.id) return false;
  // Removed participants only get the removal notice (sent to the address they had).
  if (participant.deletedAt && p.template !== "removed") return false;
  const r = participantRecipient({ email: participant.email ?? p.email ?? null, timezone: participant.timezone }, poll);
  if (!r) return false;
  const unsubscribed = Boolean(participant.unsubscribedAt);
  const unsubscribePage = await unsubscribePageUrl(poll.slug, participant.id);
  const unsubscribePost = await unsubscribePostUrl(poll.slug, participant.id);
  const loc = { ...base, locale: r.locale };
  const options = await loadOptions(db, poll.id);
  const status = statusOf(poll, options, now);
  const send = (email: RenderedEmail, opts: { unsubscribe?: boolean } = {}) =>
    deliver(db, poll, { to: r.email, email, template: p.template, key: p.key, audience: "invitee", participantId: participant.id, unsubscribe: opts.unsubscribe === false ? null : unsubscribePost });

  switch (p.template) {
    case "invitation":
    case "reminder": {
      if (unsubscribed || participant.status !== "invited" || status !== "open") return false;
      const future = futureOptions(poll, options, now);
      const voteUrl = await inviteLink(poll.slug, participant.id);
      const deadline = poll.deadlineAt ? whenLabel(poll.deadlineAt, r) : null;
      const pollZone = { ...r, zone: zoneOrUtc(poll.timezone) };
      const lines = future.map((o) => line(o, pollZone));
      const email =
        p.template === "invitation"
          ? invitationEmail({
              ...loc,
              name: participant.name || null,
              subject: typeof p.data?.subject === "string" ? p.data.subject : null,
              message: typeof p.data?.message === "string" ? p.data.message : null,
              durationLabel: durationLabel(future),
              locationKind: poll.location?.kind ?? null,
              options: lines,
              zoneLabel: zoneLabel(poll.timezone, r.locale),
              deadline,
              voteUrl,
              unsubscribeUrl: unsubscribePage,
            })
          : reminderEmail({ ...loc, name: participant.name || null, deadline, options: lines, zoneLabel: zoneLabel(poll.timezone, r.locale), voteUrl, unsubscribeUrl: unsubscribePage });
      await send(email);
      return true;
    }
    case "confirmation": {
      const votes = votesByParticipant(await loadVotes(db, poll.id)).get(participant.id) ?? {};
      const selections = options.filter((o) => votes[o.id] === "yes" || votes[o.id] === "if_need_be").map((o) => line(o, r, { choice: poll.allowIfNeedBe ? votes[o.id] : null }));
      await send(voterConfirmationEmail({ ...loc, declined: participant.status === "declined", selections, editUrl: await editLink(poll.slug, participant.id), unsubscribeUrl: unsubscribePage }));
      return true;
    }
    case "edit_link": {
      const invited = participant.status === "invited";
      const url = invited ? await inviteLink(poll.slug, participant.id) : await editLink(poll.slug, participant.id);
      await send(editLinkEmail({ ...loc, invited, url }), { unsubscribe: false });
      return true;
    }
    case "votes_edited":
    case "added_on_behalf": {
      if (unsubscribed) return false;
      const votes = votesByParticipant(await loadVotes(db, poll.id)).get(participant.id) ?? {};
      const selections = options.filter((o) => votes[o.id] === "yes" || votes[o.id] === "if_need_be").map((o) => line(o, r, { choice: poll.allowIfNeedBe ? votes[o.id] : null }));
      await send(
        hostChangedVotesEmail({ ...loc, kind: p.template === "votes_edited" ? "edited" : "addedOnBehalf", selections, editUrl: await editLink(poll.slug, participant.id), unsubscribeUrl: unsubscribePage }),
      );
      return true;
    }
    case "poll_updated": {
      if (unsubscribed || status !== "open") return false;
      const ids = Array.isArray(p.data?.optionIds) ? (p.data.optionIds as string[]) : [];
      const fresh = options.filter((o) => ids.includes(o.id));
      if (!fresh.length) return false;
      await send(pollUpdatedEmail({ ...loc, newTimes: fresh.map((o) => line(o, r)), zoneLabel: zoneLabel(r.zone, r.locale), editUrl: await editLink(poll.slug, participant.id), unsubscribeUrl: unsubscribePage }));
      return true;
    }
    case "removed":
    case "reopened":
    case "canceled":
    case "time_chosen": {
      if (unsubscribed && p.template !== "removed") return false;
      if (p.template === "reopened" && status !== "open") return false;
      let when: string | null = null;
      if (p.template === "time_chosen") {
        const o = options.find((x) => x.id === p.data?.optionId);
        if (!o) return false;
        when = line(o, r).label;
      }
      const url = p.template === "reopened" ? await editLink(poll.slug, participant.id) : null;
      await send(participantNoticeEmail({ ...loc, kind: p.template === "time_chosen" ? "timeChosen" : p.template, when, url, unsubscribeUrl: p.template === "removed" ? null : unsubscribePage }), { unsubscribe: p.template !== "removed" });
      return true;
    }
    default:
      log.warn("polls.unknown_email_template", { template: p.template });
      return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// polls.notify: one activity (vote received, new comment)

/** Hosts who get instant emails: the owner per the poll's setting, co-hosts per their own notification preference. */
function instantHosts(poll: PollRow, hosts: PollHostRow[]): PollHostRow[] {
  return hosts.filter((h) => (h.role === "owner" ? poll.notifyMode === "instant" : (h.notificationPrefs ?? DEFAULT_NOTIFICATION_PREFS).pollVotes === "instant"));
}

export async function notifyActivity(db: DB, pollId: string, activityId: string): Promise<number> {
  const poll = await loadPoll(db, pollId);
  if (!poll || poll.deletedAt) return 0;
  const [a] = await db.select().from(meetingPollActivity).where(eq(meetingPollActivity.id, activityId)).limit(1);
  if (!a || a.pollId !== poll.id) return 0;
  const now = clockNow();
  const brand = await emailBrandForUser(poll.ownerUserId, db);
  const hosts = await loadPollHosts(db, poll);
  const hostName = hosts.find((h) => h.role === "owner")?.name ?? "";
  const options = await loadOptions(db, poll.id);
  const participants = await loadParticipants(db, poll.id);
  const votes = votesByParticipant(await loadVotes(db, poll.id));
  let sent = 0;

  if (a.type === "voted" || a.type === "vote_changed" || a.type === "declined") {
    const voter = participants.find((p) => p.id === a.participantId);
    if (!voter) return 0;
    const mine = votes.get(voter.id) ?? {};
    const respondents = participants.filter(isRespondent).length;
    const total = responseTotal(participants);
    for (const h of instantHosts(poll, hosts)) {
      // A host's own vote on behalf does not notify that host.
      if (a.actorUserId && a.actorUserId === h.userId) continue;
      const r = hostRecipient(h);
      const answers = futureOptions(poll, options, now)
        .filter((o) => mine[o.id] === "yes" || mine[o.id] === "if_need_be")
        .map((o) => line(o, r, { choice: mine[o.id] as VoteChoice }));
      const top = topLines(poll, options, participants, votes, r, now);
      const topId = rankTopId(poll, options, participants, votes, now);
      const email = voteReceivedEmail({
        brand,
        locale: r.locale,
        title: poll.title,
        hostName,
        voterName: voter.name,
        change: a.type,
        answers,
        top,
        respondents,
        invited: total,
        resultsUrl: resultsUrl(poll.id),
        bookUrl: topId && statusOf(poll, options, now) !== "booked" ? bookUrl(poll.id, topId) : null,
      });
      await deliver(db, poll, { to: r.email, email, template: "vote_received", key: `poll:${poll.id}:notify:${a.id}:${h.userId}`, audience: "host", userId: h.userId });
      sent++;
    }
    return sent;
  }

  if (a.type === "commented") {
    const commentId = typeof a.data.commentId === "string" ? a.data.commentId : null;
    if (!commentId) return 0;
    const [c] = await db.select().from(meetingPollComments).where(eq(meetingPollComments.id, commentId)).limit(1);
    if (!c || c.deletedAt) return 0;
    for (const h of instantHosts(poll, hosts)) {
      if (c.authorUserId === h.userId) continue;
      const r = hostRecipient(h);
      const email = commentEmail({ brand, locale: r.locale, title: poll.title, hostName, author: c.authorName, body: c.body, url: resultsUrl(poll.id), buttonLabel: "viewResults", unsubscribeUrl: null, toHost: true });
      await deliver(db, poll, { to: r.email, email, template: "comment", key: `poll:${poll.id}:comment:${c.id}:${h.userId}`, audience: "host", userId: h.userId });
      sent++;
    }
    // Subscribed voters see public comments (never host_only ones).
    if (c.visibility === "public" && poll.resultsVisibility !== "host_only") {
      for (const p of participants) {
        if (!p.subscribedToUpdates || p.unsubscribedAt || !p.email || p.id === c.participantId) continue;
        const r = participantRecipient(p, poll)!;
        const email = commentEmail({ brand, locale: r.locale, title: poll.title, hostName, author: c.authorName, body: c.body, url: await editLink(poll.slug, p.id), buttonLabel: "viewPoll", unsubscribeUrl: await unsubscribePageUrl(poll.slug, p.id), toHost: false });
        await deliver(db, poll, { to: r.email, email, template: "comment", key: `poll:${poll.id}:comment:${c.id}:p:${p.id}`, audience: "invitee", participantId: p.id, unsubscribe: await unsubscribePostUrl(poll.slug, p.id) });
        sent++;
      }
    }
  }
  return sent;
}

function rankTopId(poll: PollRow, options: OptionRow[], participants: ParticipantRow[], votes: ReturnType<typeof votesByParticipant>, now: Date): string | null {
  const flat = [...votes.entries()].flatMap(([participantId, v]) => Object.entries(v).map(([optionId, choice]) => ({ participantId, optionId, choice })));
  const ranked = rankPollOptions(options.map((o) => ({ id: o.id, start: startOf(o, poll.timezone) })), flat, participants.map((p) => ({ id: p.id, status: p.status, isRequired: p.isRequired })), [], now);
  const top = ranked.find((x) => !x.isPast && x.attendable > 0);
  return top?.id ?? null;
}

/** polls.notify_subscribers: "Others voted" for subscribed voters, once per 10 minute window (MP-23). */
export async function notifySubscribers(db: DB, pollId: string, from: Date, to: Date): Promise<number> {
  const poll = await loadPoll(db, pollId);
  if (!poll || poll.deletedAt) return 0;
  if (!visibilityFlags(poll.resultsVisibility, true).showCounts) return 0;
  const now = clockNow();
  const activity = await db
    .select({ participantId: meetingPollActivity.participantId })
    .from(meetingPollActivity)
    .where(and(eq(meetingPollActivity.pollId, poll.id), inArray(meetingPollActivity.type, ["voted", "vote_changed", "declined"]), gte(meetingPollActivity.createdAt, from), lt(meetingPollActivity.createdAt, to)));
  if (!activity.length) return 0;
  const voters = new Set(activity.map((x) => x.participantId));
  const options = await loadOptions(db, poll.id);
  const participants = await loadParticipants(db, poll.id);
  const votes = votesByParticipant(await loadVotes(db, poll.id));
  const brand = await emailBrandForUser(poll.ownerUserId, db);
  const hostName = await ownerName(db, poll);
  const respondents = participants.filter(isRespondent).length;
  const total = responseTotal(participants);
  let sent = 0;
  for (const p of participants) {
    if (!p.subscribedToUpdates || p.unsubscribedAt || !p.email) continue;
    // Their own vote alone does not trigger "others voted".
    if ([...voters].every((v) => v === p.id)) continue;
    const r = participantRecipient(p, poll)!;
    const email = othersVotedEmail({
      brand,
      locale: r.locale,
      title: poll.title,
      hostName,
      respondents,
      invited: total,
      top: topLines(poll, options, participants, votes, r, now),
      pollUrl: await editLink(poll.slug, p.id),
      unsubscribeUrl: await unsubscribePageUrl(poll.slug, p.id),
    });
    await deliver(db, poll, { to: r.email, email, template: "others_voted", key: `poll:${poll.id}:others:${from.getTime()}:${p.id}`, audience: "invitee", participantId: p.id, unsubscribe: await unsubscribePostUrl(poll.slug, p.id) });
    sent++;
  }
  return sent;
}

// ---------------------------------------------------------------------------------------------------------------
// Host status emails (#11 voting closed, #12 deadline approaching, #13 ended without booking)

export async function sendHostStatus(db: DB, poll: PollRow, kind: "votingClosed" | "deadlineWarning" | "ended", key: string): Promise<number> {
  const now = clockNow();
  const hosts = await loadPollHosts(db, poll);
  const owner = hosts.find((h) => h.role === "owner");
  if (!owner) return 0;
  const brand = await emailBrandForUser(poll.ownerUserId, db);
  const options = await loadOptions(db, poll.id);
  const participants = await loadParticipants(db, poll.id);
  const votes = votesByParticipant(await loadVotes(db, poll.id));
  const r = hostRecipient(owner);
  const top = topLines(poll, options, participants, votes, r, now, 1)[0] ?? null;
  const topId = rankTopId(poll, options, participants, votes, now);
  const url =
    kind === "votingClosed" && topId ? bookUrl(poll.id, topId) : kind === "ended" ? absoluteUrl(`/app/polls/${encodeURIComponent(poll.id)}?duplicate=1`) : resultsUrl(poll.id);
  const email = hostStatusEmail({
    brand,
    locale: r.locale,
    title: poll.title,
    hostName: owner.name,
    kind,
    when: poll.deadlineAt ? whenLabel(poll.deadlineAt, r) : null,
    respondents: participants.filter(isRespondent).length,
    invited: responseTotal(participants),
    top,
    url,
  });
  await deliver(db, poll, { to: r.email, email, template: kind, key, audience: "host", userId: owner.userId });
  return 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Automatic reminders (#8)

/** Sends one planned reminder to every eligible invited non-respondent (re-checked at send time, MP-24). */
export async function sendAutomaticReminders(db: DB, pollId: string, opts: { kind: "anchor" | "after_invite"; index: number; participantIds?: string[] }): Promise<number> {
  const poll = await loadPoll(db, pollId);
  if (!poll || poll.deletedAt || poll.reminderMode === "off") return 0;
  const now = clockNow();
  const options = await loadOptions(db, poll.id);
  if (statusOf(poll, options, now) !== "open") return 0;
  const rows = await db
    .select()
    .from(meetingPollParticipants)
    .where(
      and(
        eq(meetingPollParticipants.pollId, poll.id),
        eq(meetingPollParticipants.status, "invited"),
        isNull(meetingPollParticipants.deletedAt),
        isNull(meetingPollParticipants.unsubscribedAt),
        opts.participantIds?.length ? inArray(meetingPollParticipants.id, opts.participantIds) : undefined,
      ),
    );
  let sent = 0;
  for (const p of rows) {
    if (!p.email || p.reminderCount >= MAX_AUTOMATIC_REMINDERS) continue;
    const bucket = `${opts.kind}:${opts.index}:${Math.floor(now.getTime() / 3_600_000)}`;
    const ok = await sendPollEmail(db, { template: "reminder", pollId: poll.id, participantId: p.id, key: `poll:${poll.id}:reminder:${bucket}:${p.id}` });
    if (!ok) continue;
    await db.update(meetingPollParticipants).set({ reminderCount: p.reminderCount + 1, lastRemindedAt: now, updatedAt: now }).where(eq(meetingPollParticipants.id, p.id));
    sent++;
  }
  if (sent) {
    await db.insert(meetingPollActivity).values({ pollId: poll.id, type: "reminder_sent", data: { count: sent, manual: false }, createdAt: now });
  }
  return sent;
}

// ---------------------------------------------------------------------------------------------------------------
// Daily digest (#4)

/**
 * Sends the 08:00 digest to every host whose poll notifications are "daily digest" and whose local time is 8 o'clock
 * (the job runs hourly; one email per host and local date thanks to the idempotency key). Activity of the last 24 hours.
 */
export async function sendDigests(db: DB, at: Date): Promise<number> {
  // Only polls with votes or comments in the last 24 hours (the activity index, not every poll of the instance).
  const since = new Date(at.getTime() - 24 * 3_600_000);
  const recent = await db
    .select({ pollId: meetingPollActivity.pollId, type: meetingPollActivity.type })
    .from(meetingPollActivity)
    .innerJoin(meetingPolls, eq(meetingPolls.id, meetingPollActivity.pollId))
    .where(
      and(
        gte(meetingPollActivity.createdAt, since),
        lt(meetingPollActivity.createdAt, at),
        inArray(meetingPollActivity.type, ["voted", "vote_changed", "declined", "commented"]),
        isNull(meetingPolls.deletedAt),
        inArray(meetingPolls.status, ["open", "closed", "booked"]),
      ),
    );
  if (!recent.length) return 0;
  const polls = await db.select().from(meetingPolls).where(inArray(meetingPolls.id, [...new Set(recent.map((r) => r.pollId))]));
  const byUser = new Map<string, { host: PollHostRow; polls: { poll: PollRow; votes: number; comments: number }[] }>();
  for (const poll of polls) {
    const acts = recent.filter((r) => r.pollId === poll.id);
    if (!acts.length) continue;
    const hosts = await loadPollHosts(db, poll);
    for (const h of hosts) {
      const mode = h.role === "owner" ? poll.notifyMode : h.notificationPrefs.pollVotes;
      if (mode !== "daily_digest") continue;
      const local = new Intl.DateTimeFormat("en-US", { timeZone: zoneOrUtc(h.timezone), hour: "numeric", hourCycle: "h23" }).format(at);
      if (Number(local) !== 8) continue;
      const entry = byUser.get(h.userId) ?? { host: h, polls: [] };
      entry.polls.push({ poll, votes: acts.filter((a) => a.type !== "commented").length, comments: acts.filter((a) => a.type === "commented").length });
      byUser.set(h.userId, entry);
    }
  }
  let sent = 0;
  for (const [userId, entry] of byUser) {
    const r = hostRecipient(entry.host);
    const brand = await emailBrandForUser(userId, db);
    const lines = [];
    for (const x of entry.polls) {
      const options = await loadOptions(db, x.poll.id);
      const participants = await loadParticipants(db, x.poll.id);
      const votes = votesByParticipant(await loadVotes(db, x.poll.id));
      lines.push({ title: x.poll.title, votes: x.votes, comments: x.comments, top: topLines(x.poll, options, participants, votes, r, at, 1)[0] ?? null, url: resultsUrl(x.poll.id) });
    }
    const email = digestEmail({ brand, locale: r.locale, polls: lines });
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: r.zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
    const first = entry.polls[0]!.poll;
    await deliver(db, first, { to: r.email, email, template: "digest", key: `poll-digest:${userId}:${localDate}`, audience: "host", userId });
    sent++;
  }
  return sent;
}

// ---------------------------------------------------------------------------------------------------------------
// Meeting reminders of a booked poll (MP-18 "Send meeting reminders")

export async function sendMeetingReminders(db: DB, p: { pollId: string; scheduledEventId: string; start: string; minutes: number }): Promise<number> {
  const poll = await loadPoll(db, p.pollId);
  if (!poll || !poll.sendMeetingReminders) return 0;
  const [m] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.id, p.scheduledEventId)).limit(1);
  // A moved or canceled meeting has its own (or no) reminders.
  if (!m || m.status !== "active" || m.startAt.toISOString() !== new Date(p.start).toISOString() || m.startAt.getTime() <= clockNow().getTime()) return 0;
  const list = await db.select().from(invitees).where(and(eq(invitees.scheduledEventId, m.id), eq(invitees.status, "active")));
  const brand = await emailBrandForUser(m.organizerUserId, db);
  let sent = 0;
  for (const inv of list) {
    const ctx = await buildMeetingTemplateContext({ scheduledEventId: m.id, inviteeId: inv.id, recipient: "invitee", db });
    const locale = inv.locale ?? m.locale ?? "en";
    const email = renderMeetingEmail({ kind: "invitee_reminder", ctx, brand, locale, location: m.location, includeAnswers: false, manageLinks: m.settingsSnapshot.includeCancelRescheduleLinks !== false });
    const sender = await meetingSender({ hostUserId: m.organizerUserId, audience: "invitee", db });
    await sendEmail({
      to: [inv.email],
      subject: email.subject,
      html: email.html,
      text: email.text,
      fromName: sender.fromName,
      replyTo: sender.replyTo,
      template: "polls.meeting_reminder",
      category: "poll",
      idempotencyKey: `poll:${poll.id}:meeting-reminder:${m.id}:${m.startAt.getTime()}:${p.minutes}:${inv.id}`,
      related: { organizationId: m.organizationId, pollId: poll.id, scheduledEventId: m.id, inviteeId: inv.id },
    });
    sent++;
  }
  return sent;
}
