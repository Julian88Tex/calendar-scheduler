// The ADM-10 demo poll (npm run db:seed -- --demo): seedDemo creates one open "Q4 roadmap review" poll for the owner
// with its secret adhoc poll event type, five Google Meet times inside the owner's working hours, three voters (one
// comment) and one invited person, idempotently; the seeded voters' edit tokens work like real ones.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eventTypes, meetingPollComments, meetingPollOptions, meetingPollParticipants, meetingPolls, jobs } from "@/db/schema";
import { resetFakeTime, setFakeNow } from "@/lib/time/now";
import { getVoterView } from "@/lib/polls/queries";
import { demoPollSlug, seedDemo } from "@/lib/polls/seed";
import { editTokenFor } from "@/lib/polls/tokens";
import { useTestDb } from "../helpers/db";
import { NOW, setupHost } from "./helpers";

const t = useTestDb();
beforeEach(() => setFakeNow(NOW));
afterEach(() => resetFakeTime());

describe("seedDemo (ADM-10)", () => {
  it("creates the demo poll once, with voters whose edit links work", async () => {
    const host = await setupHost(t.db);
    const ctx = { ownerUserId: host.user.id, organizationId: host.user.organizationId, eventTypeIds: [] as string[] };
    await t.db.transaction((tx) => seedDemo(tx, ctx));
    await t.db.transaction((tx) => seedDemo(tx, ctx));
    const polls = await t.db.select().from(meetingPolls).where(eq(meetingPolls.ownerUserId, host.user.id));
    expect(polls).toHaveLength(1);
    const poll = polls[0]!;
    expect(poll).toMatchObject({ slug: demoPollSlug(host.user.id), title: "Q4 roadmap review", status: "open", allowComments: true });
    expect(poll.location?.kind).toBe("google_conference");
    const [et] = await t.db.select().from(eventTypes).where(eq(eventTypes.id, poll.eventTypeId));
    expect(et).toMatchObject({ type: "adhoc", bookingMethod: "poll", secret: true });
    const options = await t.db.select().from(meetingPollOptions).where(eq(meetingPollOptions.pollId, poll.id));
    expect(options).toHaveLength(5);
    expect(options.every((o) => o.startsAt!.getTime() > NOW.getTime())).toBe(true);
    const people = await t.db.select().from(meetingPollParticipants).where(eq(meetingPollParticipants.pollId, poll.id));
    expect(people.map((p) => p.status).sort()).toEqual(["invited", "responded", "responded", "responded"]);
    expect(await t.db.select().from(meetingPollComments).where(eq(meetingPollComments.pollId, poll.id))).toHaveLength(1);
    // No jobs (no emails, reminders or holds) come from the seed.
    expect((await t.db.select().from(jobs)).filter((j) => (j.payload as { pollId?: string }).pollId === poll.id)).toEqual([]);

    const ana = people.find((p) => p.email === "ana.lima@example.com")!;
    const view = await getVoterView(poll.slug, { editToken: await editTokenFor(ana.id) });
    if (view.status !== 200) throw new Error("view");
    expect(view.view.me?.name).toBe("Ana Lima");
    expect(view.view.participants?.length).toBe(3);
  });

  it("re-seeding weeks later replaces the stale demo poll (every time passed) with fresh times, once", async () => {
    const host = await setupHost(t.db);
    const ctx = { ownerUserId: host.user.id, organizationId: host.user.organizationId, eventTypeIds: [] as string[] };
    await t.db.transaction((tx) => seedDemo(tx, ctx));
    const [old] = await t.db.select().from(meetingPolls).where(eq(meetingPolls.ownerUserId, host.user.id));
    setFakeNow(new Date(NOW.getTime() + 30 * 86_400_000));
    await t.db.transaction((tx) => seedDemo(tx, ctx));
    await t.db.transaction((tx) => seedDemo(tx, ctx));
    const polls = await t.db.select().from(meetingPolls).where(eq(meetingPolls.ownerUserId, host.user.id));
    expect(polls).toHaveLength(1);
    expect(polls[0]!.id).not.toBe(old!.id);
    expect(await t.db.select().from(eventTypes).where(eq(eventTypes.id, old!.eventTypeId))).toEqual([]);
    const options = await t.db.select().from(meetingPollOptions).where(eq(meetingPollOptions.pollId, polls[0]!.id));
    expect(options.every((o) => o.startsAt!.getTime() > NOW.getTime() + 30 * 86_400_000)).toBe(true);
  });
});
