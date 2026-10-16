// OWNER: polls-core.
//
// Demo data for `npm run db:seed -- --demo` (SPEC ADM-10): one open meeting poll of the owner, "Q4 roadmap review",
// created inside the seed transaction with direct inserts (decision C2: its adhoc event type with booking_method poll
// and the owner as its host), five 60 minute options on the next Tuesday, Wednesday and Thursday inside the owner's
// working hours, three voters (one public comment) and one invited person who has not answered yet. Idempotent: the
// poll slug is derived from the owner id; an existing poll is left untouched while it still has a future time (or a
// meeting), and a stale one whose times all passed is replaced with fresh times. Like the rest of the seed it publishes
// no events and enqueues no jobs (no emails, no reminders, no holds). Voter tokens use the same derivation as real
// participants, with the session key read inside the seed transaction (env first, then app_secrets).
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import type { DbOrTx } from "@/db";
import {
  eventTypeHosts,
  eventTypes,
  meetingPollActivity,
  meetingPollComments,
  meetingPollOptions,
  meetingPollParticipants,
  meetingPolls,
  meetingPollVotes,
  scheduledEvents,
  users,
} from "@/db/schema";
import { normalizeEmail } from "@/lib/validation";
import { newId } from "@/lib/ids";
import { getOrCreateAppSecret, keyFromString } from "@/lib/secrets";
import { now as clockNow } from "@/lib/time/now";
import { POLL_COLOR } from "./constants";
import { tokenHashesWithKey } from "./tokens";

export type SeedDemoContext = {
  ownerUserId: string;
  /** The owner's organization. */
  organizationId?: string;
  /** The seeded owner event types (30min, 60min, meal). */
  eventTypeIds: string[];
};

const TITLE = "Q4 roadmap review";
const DESCRIPTION =
  "<p>Let's walk through the Q4 roadmap together and agree on priorities. Pick every time that works for you and I'll book the one that suits most people.</p>";
const DURATION = 60;

/** [day index (0 = first Tuesday), local start "HH:mm"] */
const OPTION_TIMES: [number, string][] = [
  [0, "13:00"],
  [0, "15:00"],
  [1, "13:00"],
  [2, "14:00"],
  [2, "16:00"],
];

const VOTERS: { name: string; email: string; timezone: string; yes: number[]; comment?: string }[] = [
  { name: "Ana Lima", email: "ana.lima@example.com", timezone: "America/New_York", yes: [0, 2, 3], comment: "Thursday afternoon works best for me, Tuesday is a backup." },
  { name: "Ben Ortiz", email: "ben.ortiz@example.com", timezone: "America/Chicago", yes: [2, 3, 4] },
  { name: "Chloe Park", email: "chloe.park@example.com", timezone: "Europe/London", yes: [1, 2] },
];
const INVITED = { name: "Dev Patel", email: "dev.patel@example.com" };

/** The deterministic demo slug of an owner. */
export function demoPollSlug(ownerUserId: string): string {
  return `demo-${ownerUserId.replace(/-/g, "").slice(0, 12).toLowerCase()}`;
}

/** Same lookup order as getSecret("session_secret"), but reading app_secrets through the seed transaction. */
async function sessionKey(tx: DbOrTx): Promise<Buffer> {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return keyFromString(fromEnv);
  const value = await getOrCreateAppSecret("session_secret", () => randomBytes(32).toString("base64url"), tx);
  const buf = Buffer.from(value, "base64url");
  return buf.length === 32 ? buf : keyFromString(value);
}

/** The next Tuesday, Wednesday and Thursday at least three days ahead (owner zone). */
function demoDates(zone: string, at: Date): DateTime[] {
  const out: DateTime[] = [];
  let d = DateTime.fromJSDate(at, { zone }).startOf("day").plus({ days: 3 });
  while (out.length < 3) {
    if (d.weekday >= 2 && d.weekday <= 4 && (out.length === 0 ? d.weekday === 2 : true)) out.push(d);
    d = d.plus({ days: 1 });
  }
  return out;
}

export async function seedDemo(tx: DbOrTx, ctx: SeedDemoContext): Promise<void> {
  const slug = demoPollSlug(ctx.ownerUserId);
  const [existing] = await tx
    .select({ id: meetingPolls.id, eventTypeId: meetingPolls.eventTypeId, status: meetingPolls.status, bookedScheduledEventId: meetingPolls.bookedScheduledEventId })
    .from(meetingPolls)
    .where(eq(meetingPolls.slug, slug))
    .limit(1);
  if (existing) {
    // Re-running the seed keeps a demo poll that is still useful (a future time, or booked) and replaces a stale one
    // whose times all passed, so `db:seed -- --demo` always leaves a poll to vote on.
    const options = await tx.select({ startsAt: meetingPollOptions.startsAt }).from(meetingPollOptions).where(eq(meetingPollOptions.pollId, existing.id));
    const [meeting] = await tx.select({ id: scheduledEvents.id }).from(scheduledEvents).where(eq(scheduledEvents.pollId, existing.id)).limit(1);
    const future = options.some((o) => o.startsAt && o.startsAt.getTime() > clockNow().getTime());
    if (future || meeting || existing.bookedScheduledEventId || existing.status === "booked") return;
    await tx.delete(meetingPolls).where(eq(meetingPolls.id, existing.id));
    await tx.delete(eventTypes).where(eq(eventTypes.id, existing.eventTypeId));
  }

  const [owner] = await tx.select({ id: users.id, timezone: users.timezone, locale: users.locale }).from(users).where(eq(users.id, ctx.ownerUserId)).limit(1);
  if (!owner) throw new Error("[seed] polls demo: owner not found");
  let organizationId = ctx.organizationId ?? null;
  if (!organizationId && ctx.eventTypeIds[0]) {
    const [et] = await tx.select({ organizationId: eventTypes.organizationId }).from(eventTypes).where(eq(eventTypes.id, ctx.eventTypeIds[0])).limit(1);
    organizationId = et?.organizationId ?? null;
  }
  if (!organizationId) throw new Error("[seed] polls demo: owner organization not found");

  const zone = owner.timezone || "America/Los_Angeles";
  const locale = owner.locale || "en";
  const at = clockNow();
  const createdAt = new Date(at.getTime() - 2 * 86_400_000);
  const dates = demoDates(zone, at);
  // Google Meet, like the owner's virtual event types (docs/SCOPE.md: conferencing is Google Meet only).
  const location = { id: newId(), kind: "google_conference" as const, position: 0 };

  const eventTypeId = newId();
  await tx.insert(eventTypes).values({
    id: eventTypeId,
    organizationId,
    ownerUserId: owner.id,
    type: "adhoc",
    bookingMethod: "poll",
    kind: "solo",
    slug: `poll-${slug}`,
    name: TITLE,
    descriptionHtml: DESCRIPTION,
    descriptionPlain: "Let's walk through the Q4 roadmap together and agree on priorities. Pick every time that works for you and I'll book the one that suits most people.",
    color: POLL_COLOR,
    secret: true,
    active: true,
    durationMinutes: DURATION,
    locations: [location],
    locale,
    scope: "personal",
    poolingType: null,
    minimumNoticeMinutes: 0,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    dateRangeType: "unlimited",
    allowGuests: false,
    notificationType: "email_confirmation",
    organizerUserId: owner.id,
    createdByUserId: owner.id,
    createdAt,
    updatedAt: createdAt,
  });
  await tx.insert(eventTypeHosts).values({ eventTypeId, userId: owner.id, poolId: null, position: 0 });

  const pollId = newId();
  await tx.insert(meetingPolls).values({
    id: pollId,
    eventTypeId,
    organizationId,
    ownerUserId: owner.id,
    slug,
    title: TITLE,
    descriptionHtml: DESCRIPTION,
    defaultDurationMinutes: DURATION,
    location,
    locale,
    timezone: zone,
    timeZoneMode: "auto",
    status: "open",
    resultsVisibility: "after_vote",
    allowIfNeedBe: false,
    requireEmail: true,
    hideInvitees: false,
    verifyEmail: false,
    allowComments: true,
    notifyMode: "instant",
    reminderMode: "smart",
    firstInviteSentAt: new Date(createdAt.getTime() + 10 * 60_000),
    createdAt,
    updatedAt: createdAt,
  });

  const optionIds = OPTION_TIMES.map(() => newId());
  await tx.insert(meetingPollOptions).values(
    OPTION_TIMES.map(([day, time], i) => {
      const [h, m] = time.split(":").map(Number) as [number, number];
      const start = dates[day]!.set({ hour: h, minute: m, second: 0, millisecond: 0 });
      return {
        id: optionIds[i]!,
        pollId,
        startsAt: start.toJSDate(),
        endsAt: start.plus({ minutes: DURATION }).toJSDate(),
        allDayDate: null,
        durationMinutes: DURATION,
        position: i,
        createdAt,
      };
    }),
  );

  const key = await sessionKey(tx);
  const activity: (typeof meetingPollActivity.$inferInsert)[] = [
    { pollId, type: "created", actorUserId: owner.id, data: { options: optionIds.length }, createdAt },
  ];

  const invitedId = newId();
  const invitedAt = new Date(createdAt.getTime() + 10 * 60_000);
  await tx.insert(meetingPollParticipants).values({
    id: invitedId,
    pollId,
    name: INVITED.name,
    email: INVITED.email,
    emailNormalized: normalizeEmail(INVITED.email),
    status: "invited",
    source: "invite",
    invitedAt,
    createdByUserId: owner.id,
    ...tokenHashesWithKey(key, invitedId),
    createdAt: invitedAt,
    updatedAt: invitedAt,
  });
  activity.push({ pollId, type: "invited", actorUserId: owner.id, data: { count: 1, participantIds: [invitedId] }, createdAt: invitedAt });

  for (const [i, v] of VOTERS.entries()) {
    const id = newId();
    const respondedAt = new Date(createdAt.getTime() + (i + 1) * 5 * 3_600_000);
    const { editTokenHash } = tokenHashesWithKey(key, id);
    await tx.insert(meetingPollParticipants).values({
      id,
      pollId,
      name: v.name,
      email: v.email,
      emailNormalized: normalizeEmail(v.email),
      timezone: v.timezone,
      locale: "en",
      status: "responded",
      source: "link",
      subscribedToUpdates: i === 0,
      editTokenHash,
      respondedAt,
      lastSubmittedAt: respondedAt,
      createdAt: respondedAt,
      updatedAt: respondedAt,
    });
    await tx.insert(meetingPollVotes).values(
      optionIds.map((optionId, j) => ({ participantId: id, optionId, pollId, choice: v.yes.includes(j) ? ("yes" as const) : ("no" as const), createdAt: respondedAt, updatedAt: respondedAt })),
    );
    activity.push({ pollId, type: "voted", participantId: id, data: { name: v.name }, createdAt: respondedAt });
    if (v.comment) {
      const commentId = newId();
      await tx.insert(meetingPollComments).values({ id: commentId, pollId, participantId: id, authorName: v.name, body: v.comment, visibility: "public", createdAt: respondedAt });
      activity.push({ pollId, type: "commented", participantId: id, data: { commentId, hostOnly: false }, createdAt: respondedAt });
    }
  }
  await tx.insert(meetingPollActivity).values(activity);
}
