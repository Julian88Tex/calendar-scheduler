// Meeting polls (backed by an adhoc event type with booking_method = 'poll', decision C2), options, participants, votes.
import type { DbOrTx } from "@/db";
import {
  eventTypeHosts,
  eventTypes,
  meetingPollOptions,
  meetingPollParticipants,
  meetingPolls,
  meetingPollVotes,
} from "@/db/schema";
import { addMinutes, normalizeEmail, one, randomToken, sha256Hex, toDate, uniq } from "./_util";
import type { TestUser } from "./users";

export type PollRow = typeof meetingPolls.$inferSelect;
export type PollOptionRow = typeof meetingPollOptions.$inferSelect;
export type PollParticipantRow = typeof meetingPollParticipants.$inferSelect;

export type CreatePollOptions = {
  owner: TestUser;
  /** Co-hosts (event_type_hosts rows with pool null; the type becomes collective). */
  coHostIds?: string[];
  title?: string;
  durationMinutes?: number;
  timezone?: string;
  /** Time options (start) or all-day options (date YYYY-MM-DD). Default: two options tomorrow at 15:00 and 16:00 UTC. */
  options?: ({ start: Date | string; durationMinutes?: number } | { date: string })[];
  participants?: { name?: string; email?: string | null; votes?: Record<number, "yes" | "if_need_be" | "no"> }[];
  overrides?: Partial<typeof meetingPolls.$inferInsert>;
};

export async function createPoll(db: DbOrTx, opts: CreatePollOptions) {
  const duration = opts.durationMinutes ?? 30;
  const title = opts.title ?? `Poll ${uniq("")}`;
  const eventType = one(
    await db
      .insert(eventTypes)
      .values({
        organizationId: opts.owner.organizationId,
        ownerUserId: opts.owner.id,
        scope: "personal",
        type: "adhoc",
        bookingMethod: "poll",
        secret: true,
        poolingType: opts.coHostIds?.length ? "collective" : null,
        name: title,
        slug: uniq("poll"),
        durationMinutes: duration,
        createdByUserId: opts.owner.id,
      })
      .returning(),
    "poll event type",
  );
  const hostIds = [opts.owner.id, ...(opts.coHostIds ?? [])];
  await db
    .insert(eventTypeHosts)
    .values(hostIds.map((userId, i) => ({ eventTypeId: eventType.id, userId, poolId: null, position: i })));

  const poll = one(
    await db
      .insert(meetingPolls)
      .values({
        eventTypeId: eventType.id,
        organizationId: opts.owner.organizationId,
        ownerUserId: opts.owner.id,
        slug: uniq("p").slice(0, 20),
        title,
        defaultDurationMinutes: duration,
        timezone: opts.timezone ?? opts.owner.timezone,
        ...opts.overrides,
      })
      .returning(),
    "poll",
  );

  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  tomorrow.setUTCHours(15, 0, 0, 0);
  const optionSpecs = opts.options ?? [{ start: tomorrow }, { start: addMinutes(tomorrow, 60) }];
  const options: PollOptionRow[] = optionSpecs.length
    ? await db
        .insert(meetingPollOptions)
        .values(
          optionSpecs.map((o, i) => {
            if ("date" in o) {
              return { pollId: poll.id, allDayDate: o.date, durationMinutes: duration, position: i };
            }
            const start = toDate(o.start);
            const minutes = o.durationMinutes ?? duration;
            return { pollId: poll.id, startsAt: start, endsAt: addMinutes(start, minutes), durationMinutes: minutes, position: i };
          }),
        )
        .returning()
    : [];

  const participants: PollParticipantRow[] = [];
  for (const p of opts.participants ?? []) {
    const email = p.email === undefined ? `${uniq("voter")}@example.com` : p.email;
    const participant = one(
      await db
        .insert(meetingPollParticipants)
        .values({
          pollId: poll.id,
          name: p.name ?? "Voter",
          email,
          emailNormalized: email ? normalizeEmail(email) : null,
          status: "responded",
          source: "link",
          editTokenHash: sha256Hex(randomToken()),
          respondedAt: new Date(),
        })
        .returning(),
      "poll participant",
    );
    const votes = Object.entries(p.votes ?? {});
    if (votes.length) {
      await db.insert(meetingPollVotes).values(
        votes.map(([index, choice]) => {
          const option = options[Number(index)];
          if (!option) throw new Error(`createPoll: option ${index} does not exist`);
          return { participantId: participant.id, optionId: option.id, pollId: poll.id, choice };
        }),
      );
    }
    participants.push(participant);
  }
  return { poll, eventType, options, participants };
}
