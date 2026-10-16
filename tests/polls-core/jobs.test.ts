// Timed work and notifications of meeting polls on PGlite (SPEC MP-22, MP-23, MP-24, MP-31): deadline warning and
// close, expiry, smart reminders to invited non-respondents only (recomputed on reopen), unsubscribe (GET changes
// nothing, POST unsubscribes; List-Unsubscribe headers), subscriber batches, the daily digest, auto-book on consensus,
// the hourly sweep and the 30 day purge.
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({ calls: [] as { to: string[]; template: string; listUnsubscribe?: { url: string } | null }[] }));

vi.mock("@/lib/email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...real,
    sendEmail: async (msg: Parameters<typeof real.sendEmail>[0]) => {
      sent.calls.push({ to: msg.to as string[], template: msg.template, listUnsubscribe: msg.listUnsubscribe });
      return real.sendEmail(msg);
    },
  };
});

const { jobs, meetingPollOptions, meetingPollParticipants } = await import("@/db/schema");
const { emailHeaders } = await import("@/lib/email");
const { resetFakeTime, setFakeNow, now } = await import("@/lib/time/now");
const { invitePeople } = await import("@/lib/polls/invites");
const { closeVoting, deletePoll, reopenVoting } = await import("@/lib/polls/manage");
const { purgeDeletedPolls, sweepPolls } = await import("@/lib/polls/job-handlers");
const { updatePoll } = await import("@/lib/polls/update");
const { sendDigests } = await import("@/lib/polls/notify");
const { unsubscribeTokenFor } = await import("@/lib/polls/tokens");
const unsubscribeRoute = await import("@/app/api/public/polls/[slug]/unsubscribe/route");
const { useTestDb } = await import("../helpers/db");
const { DAY, HOUR, MIN, NOW, advance, drain, la, newPoll, opt, outbox, participantsOf, pollRow, setupHost, vote } = await import("./helpers");

const t = useTestDb();
beforeEach(() => {
  setFakeNow(NOW);
  sent.calls = [];
});
afterEach(() => resetFakeTime());

async function optionIds(pollId: string): Promise<string[]> {
  const rows = await t.db.select().from(meetingPollOptions).where(eq(meetingPollOptions.pollId, pollId));
  return rows.sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime()).map((o) => o.id);
}

async function pendingReminders(pollId: string) {
  const rows = await t.db.select().from(jobs).where(and(eq(jobs.type, "polls.reminder"), eq(jobs.status, "pending")));
  return rows.filter((j) => (j.payload as { pollId?: string }).pollId === pollId).sort((a, b) => a.runAt.getTime() - b.runAt.getTime());
}

describe("deadline and expiry (MP-22, MP-23)", () => {
  it("warns the host 24 hours before the deadline, closes voting at the deadline and expires once every time passed", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host, { deadline: la("2030-10-08 12:00").toISOString() });
    await invitePeople(host.actor, { pollId, recipients: [{ email: "bo@example.com", name: "Bo" }] });
    const [first] = await optionIds(pollId);
    const ana = await vote(slug, { votes: [{ optionId: first!, choice: "yes" }] });
    expect(ana.ok).toBe(true);
    await drain(t.db);
    advance(5 * HOUR); // 13:00 on Monday: the warning (Tuesday 12:00 minus 24 hours) is due
    await drain(t.db);
    const warning = await outbox(t.db, { to: host.user.email, template: "polls.deadlineWarning", pollId });
    expect(warning.map((m) => m.subject)).toEqual(["Voting closes in 24 hours: Roadmap sync"]);
    advance(DAY);
    await drain(t.db);
    expect(await pollRow(t.db, pollId)).toMatchObject({ status: "closed" });
    expect((await pollRow(t.db, pollId)).votingClosedAt?.toISOString()).toBe(la("2030-10-08 12:00").toISOString());
    const closed = await outbox(t.db, { to: host.user.email, template: "polls.votingClosed", pollId });
    expect(closed.map((m) => m.subject)).toEqual(["Voting closed: Roadmap sync"]);
    expect(closed[0]!.html).toContain(`/app/polls/${pollId}?book=`);
    setFakeNow(new Date(la("2030-10-10 14:01").getTime()));
    await drain(t.db);
    expect(await pollRow(t.db, pollId)).toMatchObject({ status: "expired" });
    expect((await outbox(t.db, { to: host.user.email, template: "polls.ended", pollId })).map((m) => m.subject)).toEqual(["Your meeting poll ended: Roadmap sync"]);
  });

  it("the hourly sweep closes a poll whose deadline job was lost", async () => {
    const host = await setupHost(t.db);
    const { pollId } = await newPoll(host, { deadline: la("2030-10-07 12:00").toISOString() });
    await t.db.update(jobs).set({ status: "canceled" }).where(eq(jobs.type, "polls.deadline"));
    advance(6 * HOUR);
    expect(await sweepPolls(t.db, now())).toMatchObject({ closed: 1 });
    expect((await pollRow(t.db, pollId)).status).toBe("closed");
  });
});

describe("review regressions (MP-22, MP-23)", () => {
  it("the sweep looks only at polls that may need it, so healthy polls never crowd out a lost deadline", async () => {
    const host = await setupHost(t.db);
    for (let i = 0; i < 3; i++) await newPoll(host, { title: `Healthy ${i}` });
    const { pollId } = await newPoll(host, { deadline: la("2030-10-07 12:00").toISOString() });
    await t.db.update(jobs).set({ status: "canceled" }).where(eq(jobs.type, "polls.deadline"));
    advance(6 * HOUR);
    expect(await sweepPolls(t.db, now())).toEqual({ closed: 1, expired: 0 });
    expect((await pollRow(t.db, pollId)).status).toBe("closed");
    expect(await sweepPolls(t.db, now())).toEqual({ closed: 0, expired: 0 });
  });

  it("Close voting on a poll its deadline already closed (job not run yet) stores the close instead of failing", async () => {
    const host = await setupHost(t.db);
    const { pollId } = await newPoll(host, { deadline: la("2030-10-07 12:00").toISOString() });
    advance(6 * HOUR);
    await closeVoting(host.actor, pollId);
    expect(await pollRow(t.db, pollId)).toMatchObject({ status: "closed" });
    expect((await pollRow(t.db, pollId)).votingClosedAt?.toISOString()).toBe(la("2030-10-07 12:00").toISOString());
  });

  it("inviting someone again who unsubscribed reports them as skipped and emails nothing", async () => {
    const host = await setupHost(t.db);
    const { pollId } = await newPoll(host);
    await invitePeople(host.actor, { pollId, recipients: [{ email: "bo@example.com" }] });
    await t.db.update(meetingPollParticipants).set({ unsubscribedAt: now() }).where(eq(meetingPollParticipants.pollId, pollId));
    await drain(t.db);
    const before = (await outbox(t.db, { to: "bo@example.com", template: "polls.invitation", pollId })).length;
    expect(await invitePeople(host.actor, { pollId, recipients: [{ email: "bo@example.com" }] })).toEqual({ invited: 0, resent: 0, skipped: [{ email: "bo@example.com", reason: "unsubscribed" }] });
    await drain(t.db);
    expect(await outbox(t.db, { to: "bo@example.com", template: "polls.invitation", pollId })).toHaveLength(before);
  });
});

describe("reminders to people who haven't voted (MP-24)", () => {
  it("smart mode: the early nudge and the 48 hour reminder go to invited non-respondents only, at most once each", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host, { options: [opt("2030-10-15 10:00"), opt("2030-10-16 10:00")] });
    await invitePeople(host.actor, { pollId, recipients: [{ email: "bo@example.com", name: "Bo" }, { email: "cara@example.com", name: "Cara" }, { email: "dee@example.com", name: "Dee" }] });
    const plan = await pendingReminders(pollId);
    const invitedAt = (await participantsOf(t.db, pollId))[0]!.invitedAt!;
    expect(plan.map((j) => j.runAt.toISOString())).toEqual([new Date(invitedAt.getTime() + 3 * DAY).toISOString(), la("2030-10-13 10:00").toISOString()]);
    await drain(t.db);
    // Cara answers through her invite link; Dee unsubscribes.
    const invite = (await outbox(t.db, { to: "cara@example.com", template: "polls.invitation", pollId }))[0]!;
    const token = decodeURIComponent(/\?i=([^"&\s]+)/.exec(invite.html)![1]!);
    expect((await vote(slug, { name: "Cara", email: "cara@example.com" }, { inviteToken: token })).ok).toBe(true);
    const dee = (await participantsOf(t.db, pollId)).find((p) => p.email === "dee@example.com")!;
    const res = await unsubscribeRoute.POST(new Request(`http://localhost:3000/api/public/polls/${slug}/unsubscribe?t=${encodeURIComponent(await unsubscribeTokenFor(dee.id))}`, { method: "POST" }), { params: Promise.resolve({ slug }) });
    expect(res.status).toBe(200);

    setFakeNow(new Date(NOW.getTime() + 3 * DAY + MIN));
    await drain(t.db);
    expect((await outbox(t.db, { template: "polls.reminder", pollId })).map((m) => m.toAddresses[0])).toEqual(["bo@example.com"]);
    setFakeNow(new Date(la("2030-10-13 10:01").getTime()));
    await drain(t.db);
    const reminders = await outbox(t.db, { template: "polls.reminder", pollId });
    expect(reminders.map((m) => m.toAddresses[0])).toEqual(["bo@example.com", "bo@example.com"]);
    expect(reminders[0]!.subject).toBe("Reminder: Julian Joseph is waiting for your availability for Roadmap sync");
    expect((await participantsOf(t.db, pollId)).find((p) => p.email === "bo@example.com")?.reminderCount).toBe(2);
  });

  it("closing voting cancels the reminders and reopening recomputes them", async () => {
    const host = await setupHost(t.db);
    const { pollId } = await newPoll(host, { options: [opt("2030-10-15 10:00")] });
    await invitePeople(host.actor, { pollId, recipients: [{ email: "bo@example.com" }] });
    expect(await pendingReminders(pollId)).toHaveLength(2);
    await closeVoting(host.actor, pollId);
    expect(await pendingReminders(pollId)).toHaveLength(0);
    await reopenVoting(host.actor, { pollId });
    expect((await pendingReminders(pollId)).map((j) => (j.payload as { kind: string }).kind).sort()).toEqual(["after_invite", "anchor"]);
  });

  it("a recompute keeps a reminder that is already due (cron latency) and re-plans the future ones", async () => {
    const host = await setupHost(t.db);
    const { pollId } = await newPoll(host, { options: [opt("2030-10-15 10:00"), opt("2030-10-16 10:00")] });
    await invitePeople(host.actor, { pollId, recipients: [{ email: "bo@example.com", name: "Bo" }] });
    await drain(t.db);
    setFakeNow(new Date(NOW.getTime() + 3 * DAY + 5 * MIN)); // the nudge is due, the cron has not run yet
    await updatePoll(host.actor, { pollId, deadline: la("2030-10-14 18:00").toISOString() });
    const plan = await pendingReminders(pollId);
    expect(plan.map((j) => j.runAt.toISOString())).toEqual([expect.any(String), la("2030-10-12 18:00").toISOString()]);
    await drain(t.db);
    expect((await outbox(t.db, { template: "polls.reminder", pollId })).map((m) => m.toAddresses[0])).toEqual(["bo@example.com"]);
  });

  it("no reminders when the lead time is under 2 days, and none in off mode", async () => {
    const host = await setupHost(t.db);
    const soon = await newPoll(host, { options: [opt("2030-10-08 15:00")] });
    await invitePeople(host.actor, { pollId: soon.pollId, recipients: [{ email: "bo@example.com" }] });
    expect(await pendingReminders(soon.pollId)).toEqual([]);
    const off = await newPoll(host, { options: [opt("2030-10-15 10:00")], reminderMode: "off" });
    await invitePeople(host.actor, { pollId: off.pollId, recipients: [{ email: "bo@example.com" }] });
    expect(await pendingReminders(off.pollId)).toEqual([]);
  });
});

describe("unsubscribe (MP-23, GEN-08)", () => {
  it("participant emails carry List-Unsubscribe with one-click POST; a GET of the link changes nothing", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host);
    await invitePeople(host.actor, { pollId, recipients: [{ email: "bo@example.com" }] });
    await drain(t.db);
    const call = sent.calls.find((c) => c.template === "polls.invitation" && Boolean(c.listUnsubscribe?.url.includes(`/polls/${slug}/`)))!;
    const headers = emailHeaders({ listUnsubscribe: call.listUnsubscribe ?? null });
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(headers["List-Unsubscribe"]).toMatch(new RegExp(`^<http://localhost:3000/api/public/polls/${slug}/unsubscribe\\?t=`));
    const mail = (await outbox(t.db, { to: "bo@example.com", template: "polls.invitation", pollId }))[0]!;
    expect(mail.html).toContain(`/p/${slug}/unsubscribe?t=`);
    expect(mail.html).toContain("Unsubscribe from this poll");

    const url = call.listUnsubscribe!.url;
    const get = await unsubscribeRoute.GET(new Request(url), { params: Promise.resolve({ slug }) });
    expect(get.status).toBe(303);
    expect(get.headers.get("location")).toContain(`/p/${slug}/unsubscribe?t=`);
    expect((await participantsOf(t.db, pollId))[0]?.unsubscribedAt).toBeNull();
    const post = await unsubscribeRoute.POST(new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }), { params: Promise.resolve({ slug }) });
    expect(post.status).toBe(200);
    expect((await participantsOf(t.db, pollId))[0]?.unsubscribedAt).not.toBeNull();
    const again = await unsubscribeRoute.POST(new Request(url, { method: "POST" }), { params: Promise.resolve({ slug }) });
    expect(again.status).toBe(200);
    const bad = await unsubscribeRoute.POST(new Request(`http://localhost:3000/api/public/polls/${slug}/unsubscribe?t=nope`, { method: "POST" }), { params: Promise.resolve({ slug }) });
    expect(bad.status).toBe(404);
    // Host emails never carry List-Unsubscribe.
    expect(sent.calls.filter((c) => c.to.includes(host.user.email)).every((c) => !c.listUnsubscribe)).toBe(true);
  });
});

describe("notifications (MP-23)", () => {
  it("batches 'others voted' for subscribed voters, at most one per 10 minutes", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host, { resultsVisibility: "everyone" });
    const [a] = await optionIds(pollId);
    expect((await vote(slug, { subscribe: true, votes: [{ optionId: a!, choice: "yes" }] })).ok).toBe(true);
    expect((await vote(slug, { name: "Bo", email: "bo@example.com", votes: [{ optionId: a!, choice: "yes" }] })).ok).toBe(true);
    expect((await vote(slug, { name: "Cara", email: "cara@example.com" })).ok).toBe(true);
    await drain(t.db);
    expect(await outbox(t.db, { template: "polls.others_voted", pollId })).toEqual([]);
    advance(10 * MIN);
    await drain(t.db);
    const mails = await outbox(t.db, { template: "polls.others_voted", pollId });
    expect(mails.map((m) => [m.toAddresses[0], m.subject])).toEqual([["ana@example.com", "New responses in Roadmap sync"]]);
  });

  it("sends the daily digest at 08:00 in the host's zone instead of instant emails", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host, { notifyMode: "daily_digest" });
    advance(HOUR);
    expect((await vote(slug)).ok).toBe(true);
    await drain(t.db);
    expect(await outbox(t.db, { to: host.user.email, template: "polls.vote_received", pollId })).toEqual([]);
    expect(await sendDigests(t.db, la("2030-10-08 07:10"))).toBe(0);
    expect(await sendDigests(t.db, la("2030-10-08 08:10"))).toBe(1);
    expect(await sendDigests(t.db, la("2030-10-08 08:40"))).toBe(1);
    const digest = await outbox(t.db, { to: host.user.email, template: "polls.digest" });
    expect(digest.map((m) => m.subject)).toEqual(["Your meeting poll activity"]);
  });
});

describe("auto-book on consensus (MP-31)", () => {
  it("books the earliest time everyone invited said Yes to, and emails the host", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host, { autoBook: true });
    const [, b] = await optionIds(pollId);
    await invitePeople(host.actor, { pollId, recipients: [{ email: "ana@example.com", name: "Ana" }, { email: "bo@example.com", name: "Bo" }] });
    await drain(t.db);
    const tokenOf = async (email: string) => decodeURIComponent(/\?i=([^"&\s]+)/.exec((await outbox(t.db, { to: email, template: "polls.invitation", pollId }))[0]!.html)![1]!);
    expect((await vote(slug, { name: "Ana", email: "ana@example.com", votes: [{ optionId: b!, choice: "yes" }] }, { inviteToken: await tokenOf("ana@example.com") })).ok).toBe(true);
    await drain(t.db);
    expect((await pollRow(t.db, pollId)).status).toBe("open");
    expect((await vote(slug, { name: "Bo", email: "bo@example.com", votes: [{ optionId: b!, choice: "yes" }] }, { inviteToken: await tokenOf("bo@example.com") })).ok).toBe(true);
    await drain(t.db);
    expect(await pollRow(t.db, pollId)).toMatchObject({ status: "booked", bookedOptionId: b });
    expect((await outbox(t.db, { to: host.user.email, template: "polls.auto_booked", pollId })).map((m) => m.subject)).toEqual(["We booked Roadmap sync"]);
  });
});

describe("purge (MP-22)", () => {
  it("removes the personal data of polls deleted more than 30 days ago", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host);
    expect((await vote(slug)).ok).toBe(true);
    await deletePoll(host.actor, { pollId, notify: false });
    advance(29 * DAY);
    expect(await purgeDeletedPolls(t.db, now())).toBe(0);
    advance(2 * DAY);
    expect(await purgeDeletedPolls(t.db, now())).toBe(1);
    expect(await t.db.select().from(meetingPollParticipants).where(eq(meetingPollParticipants.pollId, pollId))).toEqual([]);
    expect(await purgeDeletedPolls(t.db, now())).toBe(0);
  });

  it("never re-selects purged polls, so every deleted poll gets its turn across batches", async () => {
    const host = await setupHost(t.db);
    const ids: string[] = [];
    for (const title of ["First", "Second", "Third"]) {
      const { pollId, slug } = await newPoll(host, { title });
      expect((await vote(slug, { email: `${title.toLowerCase()}@example.com` })).ok).toBe(true);
      await deletePoll(host.actor, { pollId, notify: false });
      ids.push(pollId);
    }
    advance(31 * DAY);
    expect(await purgeDeletedPolls(t.db, now(), { batch: 2 })).toBe(2);
    expect(await purgeDeletedPolls(t.db, now(), { batch: 2 })).toBe(1);
    expect(await purgeDeletedPolls(t.db, now(), { batch: 2 })).toBe(0);
    for (const pollId of ids) expect(await t.db.select().from(meetingPollParticipants).where(eq(meetingPollParticipants.pollId, pollId))).toEqual([]);
  });
});
