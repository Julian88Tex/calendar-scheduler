// Race safety of meeting polls on real Postgres (SPEC MP-08, MP-19, MP-25; run with npm run test:pg): concurrent votes
// for the last place on an option accept exactly one (option rows locked FOR NO KEY UPDATE in the vote transaction)
// and votes for different times never deadlock; two concurrent Book requests for one poll create one meeting (host
// locks, then the poll row in markPollBookedInTx, and the sched_poll_active_uq guard); a reserved poll time can't be
// booked on the owner's regular event type, also in the booking transaction's own recheck.
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/calendars", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/calendars")>();
  return {
    ...real,
    getExternalBusy: async (p: { userIds: string[] }) => Object.fromEntries(p.userIds.map((id) => [id, { ok: true, stale: false, nocal: false, busy: [] }])),
  };
});

const { invitees, meetingPollOptions, meetingPollVotes, scheduledEvents } = await import("@/db/schema");
const { createBooking } = await import("@/lib/booking/create");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { bookPoll } = await import("@/lib/polls/book");
const { createTestDb } = await import("../helpers/db");
const { createEventType } = await import("../factories");
const { NOW, ip, la, newPoll, pollRow, setupHost, vote } = await import("./helpers");

async function optionIds(db: Awaited<ReturnType<typeof createTestDb>>["db"], pollId: string): Promise<string[]> {
  const rows = await db.select().from(meetingPollOptions).where(eq(meetingPollOptions.pollId, pollId));
  return rows.sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime()).map((o) => o.id);
}

describe.runIf(process.env.TEST_DATABASE_URL)("meeting poll races on real Postgres", () => {
  it("concurrent votes for the last place on an option accept exactly one", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 24 });
    setFakeNow(NOW);
    try {
      const host = await setupHost(t.db);
      const { pollId, slug } = await newPoll(host, { maxVotesPerOption: 2 });
      const [a] = await optionIds(t.db, pollId);
      const first = await vote(slug, { name: "First", email: "first@example.com", votes: [{ optionId: a!, choice: "yes" }] });
      expect(first.ok).toBe(true);
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => vote(slug, { name: `Voter ${i}`, email: `v${i}@example.com`, votes: [{ optionId: a!, choice: "yes" }] }, { ip: ip() })),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && r.code === "full")).toHaveLength(7);
      const yes = await t.db.select().from(meetingPollVotes).where(eq(meetingPollVotes.optionId, a!));
      expect(yes.filter((v) => v.choice === "yes")).toHaveLength(2);
    } finally {
      resetFakeTime();
      await t.close();
    }
  });

  it("concurrent votes for different times of a capacity-limited poll never deadlock", async () => {
    // Every vote writes a row for every future time (the foreign key check takes a key share lock on each option row),
    // so the capacity lock must not conflict with key share locks: voters who newly pick different times run side by
    // side instead of deadlocking.
    const t = await createTestDb({ kind: "postgres", poolSize: 24 });
    setFakeNow(NOW);
    try {
      const host = await setupHost(t.db);
      const { pollId, slug } = await newPoll(host, { maxVotesPerOption: 50 });
      const ids = await optionIds(t.db, pollId);
      for (let round = 0; round < 3; round++) {
        const results = await Promise.all(
          Array.from({ length: 9 }, (_, i) =>
            vote(slug, { name: `Voter ${round}.${i}`, email: `r${round}v${i}@example.com`, votes: [{ optionId: ids[i % ids.length]!, choice: "yes" }] }, { ip: ip() }),
          ),
        );
        expect(results.filter((r) => !r.ok)).toEqual([]);
      }
      const yes = await t.db.select().from(meetingPollVotes).where(eq(meetingPollVotes.pollId, pollId));
      expect(yes.filter((v) => v.choice === "yes")).toHaveLength(27);
    } finally {
      resetFakeTime();
      await t.close();
    }
  });

  it("two concurrent Book requests for one poll create one meeting", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 24 });
    setFakeNow(NOW);
    try {
      const host = await setupHost(t.db);
      const { pollId, slug } = await newPoll(host);
      const [a, b] = await optionIds(t.db, pollId);
      const ana = await vote(slug, { votes: [{ optionId: a!, choice: "yes" }, { optionId: b!, choice: "yes" }] });
      if (!ana.ok) throw new Error("vote");
      const input = (optionId: string) => ({ pollId, optionId, invitees: [{ participantId: ana.participantId, email: "ana@example.com" }] });
      const same = await Promise.allSettled([bookPoll(host.actor, input(a!)), bookPoll(host.actor, input(a!))]);
      const ids = same.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<{ scheduledEventId: string }>).value.scheduledEventId);
      expect(ids.length).toBeGreaterThanOrEqual(1);
      expect(new Set(ids).size).toBe(1);
      const meetings = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.pollId, pollId));
      expect(meetings).toHaveLength(1);
      expect(await t.db.select().from(invitees).where(eq(invitees.scheduledEventId, meetings[0]!.id))).toHaveLength(1);
      expect(await pollRow(t.db, pollId)).toMatchObject({ status: "booked", bookedScheduledEventId: meetings[0]!.id });

      // Two different times at once: one wins, the other is refused.
      const other = await newPoll(host, { title: "Second poll" });
      const [c, d] = await optionIds(t.db, other.pollId);
      const bo = await vote(other.slug, { name: "Bo", email: "bo@example.com", votes: [{ optionId: c!, choice: "yes" }, { optionId: d!, choice: "yes" }] });
      if (!bo.ok) throw new Error("vote");
      const pick = (optionId: string) => bookPoll(host.actor, { pollId: other.pollId, optionId, invitees: [{ participantId: bo.participantId, email: "bo@example.com" }] });
      const diff = await Promise.allSettled([pick(c!), pick(d!)]);
      expect(diff.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.pollId, other.pollId))).toHaveLength(1);
    } finally {
      resetFakeTime();
      await t.close();
    }
  });

  it("a reserved poll time is refused by the booking transaction of the owner's regular event type", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 12 });
    setFakeNow(NOW);
    try {
      const host = await setupHost(t.db);
      await newPoll(host, { reserveTimes: true });
      const { eventType } = await createEventType(t.db, {
        owner: host.user,
        name: "30 Minute Virtual",
        slug: "30min",
        durationMinutes: 30,
        overrides: { slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, dateRangeType: "rolling", dateRangeDays: 60 },
      });
      const attempt = (local: string) =>
        createBooking({ target: { kind: "event_type", eventTypeId: eventType.id }, start: la(local).toISOString(), invitee: { name: "Zed", email: `zed.${local.replace(/\D/g, "")}@example.com`, timezone: "UTC" } }, { now: NOW });
      expect(await attempt("2030-10-09 10:00")).toMatchObject({ ok: false, code: "slot_unavailable" });
      expect((await attempt("2030-10-09 12:00")).ok).toBe(true);
    } finally {
      resetFakeTime();
      await t.close();
    }
  });
});
