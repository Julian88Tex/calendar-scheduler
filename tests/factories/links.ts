// Single-use links and one-off meetings (adhoc event type plus spots).
import type { DbOrTx } from "@/db";
import { eventTypeHosts, eventTypes, oneOffMeetings, oneOffMeetingSpots, singleUseLinks } from "@/db/schema";
import { addMinutes, one, toDate, uniq } from "./_util";
import type { EventTypeRow } from "./event-types";
import type { TestUser } from "./users";

/** 'xxxx-xxxx' style code (unique per call). */
export const linkCode = (): string => {
  const raw = uniq("").replace(/[^a-z0-9]/g, "");
  return `${raw.slice(0, Math.ceil(raw.length / 2))}-${raw.slice(Math.ceil(raw.length / 2))}`;
};

export async function createSingleUseLink(
  db: DbOrTx,
  opts: { eventType: EventTypeRow; ownerUserId?: string; code?: string; overrides?: Partial<typeof singleUseLinks.$inferInsert> },
) {
  const ownerUserId = opts.ownerUserId ?? opts.eventType.ownerUserId;
  if (!ownerUserId) throw new Error("createSingleUseLink: ownerUserId is required for team event types");
  return one(
    await db
      .insert(singleUseLinks)
      .values({
        code: opts.code ?? linkCode(),
        eventTypeId: opts.eventType.id,
        ownerUserId,
        createdByUserId: ownerUserId,
        ...opts.overrides,
      })
      .returning(),
    "single-use link",
  );
}

export async function createOneOffMeeting(
  db: DbOrTx,
  opts: { owner: TestUser; name?: string; durationMinutes?: number; spots?: (Date | string)[]; timezone?: string },
) {
  const duration = opts.durationMinutes ?? 30;
  const code = linkCode();
  const eventType = one(
    await db
      .insert(eventTypes)
      .values({
        organizationId: opts.owner.organizationId,
        ownerUserId: opts.owner.id,
        scope: "personal",
        type: "adhoc",
        secret: true,
        name: opts.name ?? "One-off meeting",
        slug: uniq("oneoff"),
        shareCode: code,
        durationMinutes: duration,
        createdByUserId: opts.owner.id,
      })
      .returning(),
    "one-off event type",
  );
  await db.insert(eventTypeHosts).values({ eventTypeId: eventType.id, userId: opts.owner.id, poolId: null });
  const oneOff = one(
    await db
      .insert(oneOffMeetings)
      .values({ code, eventTypeId: eventType.id, ownerUserId: opts.owner.id, timezone: opts.timezone ?? opts.owner.timezone })
      .returning(),
    "one-off meeting",
  );
  const starts = opts.spots ?? [new Date(Date.now() + 2 * 24 * 3600_000)];
  const spots = starts.length
    ? await db
        .insert(oneOffMeetingSpots)
        .values(
          starts.map((s) => {
            const start = toDate(s);
            return { oneOffMeetingId: oneOff.id, startAt: start, endAt: addMinutes(start, duration) };
          }),
        )
        .returning()
    : [];
  return { oneOff, eventType, spots };
}
