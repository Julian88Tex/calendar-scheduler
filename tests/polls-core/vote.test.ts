// Creating polls and voting on PGlite (SPEC MP-03, MP-04, MP-06, MP-08 to MP-12, MP-14, MP-23, MP-30): the adhoc
// event type and defaults, votes through the link with explicit No rows, duplicate email protection with a magic
// link, edit tokens, invite links, Decline, max choices and capacity, If need be off, the deadline on every write,
// votes on removed options never counted, rate limits, email verification, visibility redaction and comments.
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eventTypeHosts, eventTypes, jobs, meetingPollActivity, meetingPollOptions } from "@/db/schema";
import { resetFakeTime, setFakeNow } from "@/lib/time/now";
import { addHostComment, addPublicComment, deleteHostComment, deletePublicComment } from "@/lib/polls/comments";
import { createPoll } from "@/lib/polls/create";
import { invitePeople } from "@/lib/polls/invites";
import { getHostPoll, getVoterView } from "@/lib/polls/queries";
import { removeOptions } from "@/lib/polls/update";
import { requestVoteCode, verifyEditLink } from "@/lib/polls/vote";
import { useTestDb } from "../helpers/db";
import { DAY, HOUR, LA, NOW, advance, drain, ip, la, newPoll, opt, outbox, participantsOf, pollRow, setupHost, vote, votesOf } from "./helpers";

const t = useTestDb();
beforeEach(() => setFakeNow(NOW));
afterEach(() => resetFakeTime());

async function optionIds(pollId: string): Promise<string[]> {
  const rows = await t.db.select().from(meetingPollOptions).where(eq(meetingPollOptions.pollId, pollId));
  return rows.sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime()).map((o) => o.id);
}

function okVote(r: Awaited<ReturnType<typeof vote>>) {
  if (!r.ok) throw new Error(`vote failed: ${r.code} ${r.message}`);
  return r;
}

describe("createPoll (MP-03, MP-04)", () => {
  it("creates an open poll with its secret adhoc poll event type, the owner as host, the options and Calendly defaults", async () => {
    const host = await setupHost(t.db);
    const created = await newPoll(host);
    const poll = await pollRow(t.db, created.pollId);
    expect(poll).toMatchObject({
      status: "open",
      resultsVisibility: "host_only",
      allowIfNeedBe: false,
      hideInvitees: false,
      requireEmail: true,
      verifyEmail: false,
      allowComments: false,
      notifyMode: "instant",
      reminderMode: "smart",
      timezone: LA,
    });
    expect(created.slug).toMatch(/^[a-z0-9]{10}$/);
    expect(created.link).toBe(`http://localhost:3000/p/${created.slug}`);
    const [et] = await t.db.select().from(eventTypes).where(eq(eventTypes.id, created.eventTypeId));
    expect(et).toMatchObject({ type: "adhoc", bookingMethod: "poll", secret: true, name: "Roadmap sync", bufferBeforeMinutes: 0, bufferAfterMinutes: 0, notificationType: "email_confirmation" });
    const hosts = await t.db.select().from(eventTypeHosts).where(eq(eventTypeHosts.eventTypeId, et!.id));
    expect(hosts.map((h) => h.userId)).toEqual([host.user.id]);
    expect(await optionIds(poll.id)).toHaveLength(3);
    const [expire] = await t.db.select().from(jobs).where(and(eq(jobs.type, "polls.expire"), eq(jobs.status, "pending")));
    expect(expire?.runAt.toISOString()).toBe(la("2030-10-10 14:00").toISOString());
  });

  it("validates options and the deadline, drops exact duplicates and refuses a taken link ending", async () => {
    const host = await setupHost(t.db);
    await expect(newPoll(host, { options: [opt("2030-10-06 10:00")] })).rejects.toMatchObject({ code: "validation", message: "Choose a time in the future." });
    await expect(newPoll(host, { options: [{ start: la("2030-10-09 10:00").toISOString(), end: la("2030-10-09 10:03").toISOString() }] })).rejects.toMatchObject({ code: "validation" });
    await expect(newPoll(host, { deadline: la("2030-10-11 09:00").toISOString() })).rejects.toMatchObject({ message: "The deadline can't be after the last proposed time." });
    const created = await newPoll(host, { options: [opt("2030-10-09 10:00"), opt("2030-10-09 10:00"), opt("2030-10-09 11:00")], slug: "team-sync" });
    expect(await optionIds(created.pollId)).toHaveLength(2);
    await expect(newPoll(host, { slug: "team-sync" })).rejects.toMatchObject({ code: "conflict", message: "This link is already taken." });
  });
});

describe("voting (MP-08 to MP-11)", () => {
  it("records Yes and explicit No rows, emails the host once (notify instant) and confirms to the voter", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host);
    const [a, b, c] = await optionIds(pollId);
    const r = okVote(await vote(slug, { votes: [{ optionId: a!, choice: "yes" }, { optionId: c!, choice: "yes" }] }));
    expect(r.created).toBe(true);
    expect(r.editToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await votesOf(t.db, r.participantId)).toEqual({ [a!]: "yes", [b!]: "no", [c!]: "yes" });
    await drain(t.db);
    const hostMails = await outbox(t.db, { to: host.user.email, template: "polls.vote_received" });
    expect(hostMails).toHaveLength(1);
    expect(hostMails[0]!.subject).toBe("Ana Lima has voted in a poll for Roadmap sync");
    expect(hostMails[0]!.html).toContain(`/app/polls/${pollId}`);
    const confirm = await outbox(t.db, { to: "ana@example.com", template: "polls.confirmation" });
    expect(confirm).toHaveLength(1);
    expect(confirm[0]!.subject).toBe("Thanks for voting: Roadmap sync");
    expect(confirm[0]!.html).toContain(`/api/public/polls/${slug}/edit?t=`);
  });

  it("never lets someone else's email overwrite their votes: duplicate_email and a magic link to the owner of the email", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host);
    const [a, b] = await optionIds(pollId);
    const first = okVote(await vote(slug, { votes: [{ optionId: a!, choice: "yes" }] }));
    const second = await vote(slug, { name: "Mallory", email: "ANA@example.com", votes: [{ optionId: b!, choice: "yes" }] });
    expect(second).toMatchObject({ ok: false, code: "duplicate_email", message: "You've already voted with this email. We've sent you a link to update your response." });
    expect(await votesOf(t.db, first.participantId)).toMatchObject({ [a!]: "yes", [b!]: "no" });
    expect(await participantsOf(t.db, pollId)).toHaveLength(1);
    await drain(t.db);
    const link = await outbox(t.db, { to: "ana@example.com", template: "polls.edit_link" });
    expect(link).toHaveLength(1);
    expect(link[0]!.html).toContain(`/api/public/polls/${slug}/edit?t=`);
  });

  it("updates the same participant with the edit token and records vote_changed", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host);
    const [a, b] = await optionIds(pollId);
    const first = okVote(await vote(slug, { votes: [{ optionId: a!, choice: "yes" }] }));
    const second = okVote(await vote(slug, { votes: [{ optionId: b!, choice: "yes" }] }, { editToken: first.editToken }));
    expect(second).toMatchObject({ participantId: first.participantId, created: false });
    expect(await votesOf(t.db, first.participantId)).toMatchObject({ [a!]: "no", [b!]: "yes" });
    const activity = await t.db.select().from(meetingPollActivity).where(eq(meetingPollActivity.pollId, pollId));
    expect(activity.map((x) => x.type)).toEqual(expect.arrayContaining(["voted", "vote_changed"]));
    expect(await verifyEditLink(slug, first.editToken)).toEqual({ slug, valid: true });
    expect(await verifyEditLink(slug, "x".repeat(43))).toEqual({ slug, valid: false });
  });

  it("replays a double click from the same client only: never hands someone else's edit token to another client", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host);
    const [a] = await optionIds(pollId);
    const requestId = "0b7f3c1e-5a3d-4c2b-9f00-1d2e3f4a5b6c";
    const first = okVote(await vote(slug, { votes: [{ optionId: a!, choice: "yes" }], requestId }, { ip: "198.51.100.7" }));
    const again = okVote(await vote(slug, { votes: [{ optionId: a!, choice: "yes" }], requestId }, { ip: "198.51.100.7" }));
    expect(again).toMatchObject({ participantId: first.participantId, editToken: first.editToken, created: false });
    // The same request id from another client is a new submission (and never answers with Ana's edit token).
    const other = okVote(await vote(slug, { name: "Bo Chen", email: "bo@example.com", votes: [], requestId }, { ip: "198.51.100.8" }));
    expect(other.participantId).not.toBe(first.participantId);
    expect(other.editToken).not.toBe(first.editToken);
    // Short ids are not replay keys; the replay window is a few minutes.
    okVote(await vote(slug, { name: "Cy", email: "cy@example.com", votes: [], requestId: "abc" }, { ip: "198.51.100.9" }));
    const dee = okVote(await vote(slug, { name: "Dee", email: "dee@example.com", votes: [], requestId: "abc" }, { ip: "198.51.100.9" }));
    expect(dee.created).toBe(true);
    advance(11 * 60_000);
    const late = await vote(slug, { name: "Eve", email: "eve@example.com", votes: [], requestId }, { ip: "198.51.100.7" });
    expect(late).toMatchObject({ ok: true, created: true });
    expect((await participantsOf(t.db, pollId)).length).toBe(5);
    // Host views never carry the replay keys.
    const results = await getHostPoll(host.actor, pollId);
    expect(results.activity.every((x) => !("requestKey" in x.data) && !("requestId" in x.data))).toBe(true);
  });

  it("ties an invite link to the invited row: prefill locked, status responded, the email stays the invited one", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host);
    const [a] = await optionIds(pollId);
    const inv = await invitePeople(host.actor, { pollId, recipients: [{ email: "bo@example.com", name: "Bo Chen" }] });
    expect(inv).toMatchObject({ invited: 1, resent: 0 });
    await drain(t.db);
    const mail = (await outbox(t.db, { to: "bo@example.com", template: "polls.invitation" }))[0]!;
    expect(mail.subject).toBe("Julian Joseph wants to find a time: Roadmap sync");
    const token = decodeURIComponent(/\/p\/[a-z0-9-]+\?i=([^"&\s]+)/.exec(mail.html)![1]!);
    const view = await getVoterView(slug, { inviteToken: token });
    expect(view.status).toBe(200);
    if (view.status !== 200) return;
    expect(view.view.prefill).toEqual({ name: "Bo Chen", email: "bo@example.com", locked: true });
    expect(view.view.me?.status).toBe("invited");
    const r = okVote(await vote(slug, { name: "Robert", email: "other@example.com", votes: [{ optionId: a!, choice: "yes" }] }, { inviteToken: token }));
    const [p] = await participantsOf(t.db, pollId);
    expect(r.participantId).toBe(p!.id);
    expect(p).toMatchObject({ status: "responded", email: "bo@example.com", name: "Bo Chen", source: "invite" });
  });

  it("Decline saves No on every future time and counts as a respondent (MP-10)", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host);
    const ids = await optionIds(pollId);
    const r = okVote(await vote(slug, { declined: true, votes: [{ optionId: ids[0]!, choice: "yes" }] }));
    expect(r.status).toBe("declined");
    expect(Object.values(await votesOf(t.db, r.participantId))).toEqual(["no", "no", "no"]);
    const hostView = await getHostPoll(host.actor, pollId);
    expect(hostView.counts).toMatchObject({ respondents: 1, declined: 1 });
    expect(hostView.hasResponses).toBe(true);
  });

  it("enforces max choices, If need be off and capacity (own selection stays, can't be re-added)", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host, { maxChoicesPerParticipant: 1, maxVotesPerOption: 1 });
    const [a, b] = await optionIds(pollId);
    expect(await vote(slug, { votes: [{ optionId: a!, choice: "yes" }, { optionId: b!, choice: "yes" }] })).toMatchObject({ ok: false, code: "max_choices", message: "You can choose up to 1 times." });
    expect(await vote(slug, { votes: [{ optionId: a!, choice: "if_need_be" }] })).toMatchObject({ ok: false, code: "validation", message: "This poll only accepts Yes or No." });
    const ana = okVote(await vote(slug, { votes: [{ optionId: a!, choice: "yes" }] }));
    expect(await vote(slug, { name: "Bo", email: "bo@example.com", votes: [{ optionId: a!, choice: "yes" }] })).toMatchObject({ ok: false, code: "full", message: "This time is full." });
    // The full option shows "Full" to others (even in host_only) but not to its own voter.
    const other = await getVoterView(slug, {});
    const own = await getVoterView(slug, { editToken: ana.editToken });
    if (other.status !== 200 || own.status !== 200) throw new Error("view");
    expect(other.view.options.find((o) => o.id === a)?.isFull).toBe(true);
    expect(own.view.options.find((o) => o.id === a)?.isFull).toBe(false);
    // Ana keeps her place when she edits, and Bo can take it once she leaves it.
    okVote(await vote(slug, { votes: [{ optionId: a!, choice: "yes" }] }, { editToken: ana.editToken }));
    okVote(await vote(slug, { votes: [] }, { editToken: ana.editToken }));
    okVote(await vote(slug, { name: "Bo", email: "bo@example.com", votes: [{ optionId: a!, choice: "yes" }] }));
    expect(await vote(slug, { votes: [{ optionId: a!, choice: "yes" }] }, { editToken: ana.editToken })).toMatchObject({ ok: false, code: "full" });
  });

  it("checks the deadline on every write, even before the deadline job ran (MP-22)", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host, { deadline: la("2030-10-08 12:00").toISOString() });
    const [a] = await optionIds(pollId);
    okVote(await vote(slug, { votes: [{ optionId: a!, choice: "yes" }] }));
    advance(30 * HOUR);
    expect((await pollRow(t.db, pollId)).status).toBe("open");
    expect(await vote(slug, { name: "Bo", email: "bo@example.com", votes: [{ optionId: a!, choice: "yes" }] })).toMatchObject({ ok: false, code: "closed", message: "Voting for this poll has closed." });
    const view = await getVoterView(slug, {});
    if (view.status !== 200) throw new Error("view");
    expect(view.view.poll.status).toBe("closed");
    expect(view.view.canVote).toBe(false);
  });

  it("never counts votes on removed times, and refuses votes on them (MP-08)", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host, { maxVotesPerOption: 1 });
    const [a, b] = await optionIds(pollId);
    okVote(await vote(slug, { votes: [{ optionId: a!, choice: "yes" }] }));
    await removeOptions(host.actor, { pollId, optionIds: [a!], confirm: true });
    expect(await vote(slug, { name: "Bo", email: "bo@example.com", votes: [{ optionId: a!, choice: "yes" }] })).toMatchObject({ ok: false, code: "validation", message: "That time is no longer part of this poll." });
    const hostView = await getHostPoll(host.actor, pollId);
    expect(hostView.options.map((o) => o.id)).not.toContain(a);
    expect(hostView.options.find((o) => o.id === b)?.counts).toMatchObject({ yes: 0, no: 1 });
  });

  it("rejects the 11th vote submit from one IP within an hour (MP-30)", async () => {
    const host = await setupHost(t.db);
    const { slug } = await newPoll(host);
    const same = ip();
    for (let i = 0; i < 10; i++) okVote(await vote(slug, { name: `Voter ${i}`, email: `v${i}@example.com` }, { ip: same }));
    await expect(vote(slug, { name: "Voter 11", email: "v11@example.com" }, { ip: same })).rejects.toMatchObject({ code: "rate_limited" });
    okVote(await vote(slug, { name: "Voter 12", email: "v12@example.com" }));
  });

  it("requires the 6-digit code when Verify email is on (MP-04)", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host, { verifyEmail: true, requireEmail: false });
    expect((await pollRow(t.db, pollId)).requireEmail).toBe(true);
    const [a] = await optionIds(pollId);
    const input = { email: "cara@example.com", name: "Cara", votes: [{ optionId: a!, choice: "yes" as const }] };
    expect(await vote(slug, input)).toMatchObject({ ok: false, code: "verification_required" });
    const sent = await requestVoteCode(slug, { email: "cara@example.com" }, { ip: ip() });
    expect(sent.required).toBe(true);
    await drain(t.db);
    const mail = (await outbox(t.db, { to: "cara@example.com", template: "polls.verification_code" }))[0]!;
    const code = /\b(\d{6})\b/.exec(mail.subject)![1]!;
    expect(await vote(slug, { ...input, verificationCode: code === "000000" ? "111111" : "000000" })).toMatchObject({ ok: false, code: "validation", message: "That code isn't right. Check your email and try again." });
    const r = okVote(await vote(slug, { ...input, verificationCode: code }));
    const [p] = await participantsOf(t.db, pollId);
    expect(p!.id).toBe(r.participantId);
    expect(p!.emailVerifiedAt).not.toBeNull();
  });
});

describe("results visibility to voters (MP-12)", () => {
  async function setup(visibility: "host_only" | "counts_only" | "after_vote" | "everyone") {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host, { resultsVisibility: visibility });
    const [a] = await optionIds(pollId);
    okVote(await vote(slug, { name: "Ana Lima", email: "ana@example.com", votes: [{ optionId: a!, choice: "yes" }] }));
    const view = async (editToken?: string) => {
      const r = await getVoterView(slug, { editToken });
      if (r.status !== 200) throw new Error("view");
      return r.view;
    };
    return { slug, a: a!, view };
  }

  it("host_only: no other participant names, counts or emails in the JSON", async () => {
    const { view } = await setup("host_only");
    const v = await view();
    const json = JSON.stringify(v);
    expect(json).not.toContain("Ana Lima");
    expect(json).not.toContain("ana@example.com");
    expect(v.participants).toBeNull();
    expect(v.respondentCount).toBeNull();
    expect(v.options.every((o) => o.counts === null && o.voters === null)).toBe(true);
  });

  it("counts_only: counts without names", async () => {
    const { view, a } = await setup("counts_only");
    const v = await view();
    expect(v.options.find((o) => o.id === a)?.counts).toEqual({ yes: 1, ifNeedBe: 0 });
    expect(JSON.stringify(v)).not.toContain("Ana Lima");
  });

  it("after_vote: nothing before the viewer submits, then names", async () => {
    const { view, slug, a } = await setup("after_vote");
    expect(JSON.stringify(await view())).not.toContain("Ana Lima");
    const bo = okVote(await vote(slug, { name: "Bo", email: "bo@example.com", votes: [{ optionId: a, choice: "yes" }] }));
    const v = await view(bo.editToken);
    expect(v.options.find((o) => o.id === a)?.voters?.yes).toEqual(["Ana Lima", "Bo"]);
    expect(JSON.stringify(v)).not.toContain("ana@example.com");
  });

  it("everyone: names and the grid, never other emails", async () => {
    const { view } = await setup("everyone");
    const v = await view();
    expect(v.participants?.map((p) => p.name)).toEqual(["Ana Lima"]);
    expect(JSON.stringify(v)).not.toContain("ana@example.com");
  });
});

describe("comments (MP-14)", () => {
  it("host_only polls: a comment is visible to its author and the hosts, not to other voters", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host, { allowComments: true });
    const ana = okVote(await vote(slug, { comment: "Thursday works best" }));
    const bo = okVote(await vote(slug, { name: "Bo", email: "bo@example.com" }));
    const asAna = await getVoterView(slug, { editToken: ana.editToken });
    const asBo = await getVoterView(slug, { editToken: bo.editToken });
    if (asAna.status !== 200 || asBo.status !== 200) throw new Error("view");
    expect(asAna.view.comments?.map((c) => c.body)).toEqual(["Thursday works best"]);
    expect(asAna.view.comments?.[0]).toMatchObject({ canDelete: true, hostOnly: true });
    expect(asBo.view.comments).toEqual([]);
    expect(asBo.view.poll.commentsHostOnly).toBe(true);
    expect((await getHostPoll(host.actor, pollId)).comments.map((c) => c.body)).toEqual(["Thursday works best"]);
  });

  it("public comments: everyone sees them, authors delete their own, hosts delete any, Host badge", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host, { allowComments: true, resultsVisibility: "everyone" });
    const ana = okVote(await vote(slug));
    const { commentId } = await addPublicComment(slug, { body: "See https://example.com/agenda\nthanks" }, { editToken: ana.editToken, ip: ip() });
    const { commentId: fromHost } = await addHostComment(host.actor, pollId, { body: "Booking soon" });
    const anon = await getVoterView(slug, {});
    if (anon.status !== 200) throw new Error("view");
    expect(anon.view.comments?.map((c) => [c.authorName, c.isHost, c.canDelete])).toEqual([
      ["Ana Lima", false, false],
      ["Julian Joseph", true, false],
    ]);
    await expect(deletePublicComment(slug, fromHost, { editToken: ana.editToken })).rejects.toMatchObject({ code: "not_found" });
    await deletePublicComment(slug, commentId, { editToken: ana.editToken });
    await deleteHostComment(host.actor, pollId, fromHost);
    expect((await getHostPoll(host.actor, pollId)).comments).toEqual([]);
    await expect(addPublicComment(slug, { body: "Anonymous" }, { ip: ip() })).rejects.toMatchObject({ code: "validation", message: "Enter your name." });
  });

  it("refuses comments when they are off", async () => {
    const host = await setupHost(t.db);
    const { slug } = await createPoll(host.actor, { title: "No comments", timezone: LA, defaultDurationMinutes: 30, options: [opt("2030-10-09 10:00")] });
    await expect(addPublicComment(slug, { body: "Hi", name: "Ana" }, { ip: ip() })).rejects.toMatchObject({ message: "Comments are turned off for this poll." });
  });
});

describe("host preview (MP-05 'View live page')", () => {
  it("flags the signed-in host and never saves their votes; other signed-in users vote and are matched by user id", async () => {
    const host = await setupHost(t.db);
    const colleague = await setupHost(t.db, { name: "Kim Lee", organizationId: host.user.organizationId, orgRole: "user" });
    const { pollId, slug } = await newPoll(host);
    const view = await getVoterView(slug, { viewer: { userId: host.user.id, name: host.user.name, email: host.user.email } });
    if (view.status !== 200) throw new Error("view");
    expect(view.view.viewerIsHost).toBe(true);
    expect(await vote(slug, { name: host.user.name, email: host.user.email }, { userId: host.user.id })).toMatchObject({ ok: false, code: "preview", message: "Preview, your votes will not be saved" });
    expect(await participantsOf(t.db, pollId)).toEqual([]);
    const r = okVote(await vote(slug, { name: "Kim Lee", email: colleague.user.email }, { userId: colleague.user.id }));
    const again = await getVoterView(slug, { viewer: { userId: colleague.user.id, name: "Kim Lee", email: colleague.user.email } });
    if (again.status !== 200) throw new Error("view");
    expect(again.view.viewerIsHost).toBe(false);
    expect(again.view.me?.participantId).toBe(r.participantId);
  });
});

describe("who a request speaks for (MP-06, MP-09, MP-11)", () => {
  it("a personal invite link wins over another voter's edit cookie on a shared browser", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host);
    const [a, b] = await optionIds(pollId);
    const ana = okVote(await vote(slug, { name: "Ana Lima", email: "ana@example.com", votes: [{ optionId: a!, choice: "yes" }] }));
    await invitePeople(host.actor, { pollId, recipients: [{ email: "bo@example.com", name: "Bo Chen" }] });
    await drain(t.db);
    const mail = (await outbox(t.db, { to: "bo@example.com", template: "polls.invitation", pollId }))[0]!;
    const token = decodeURIComponent(/\/p\/[a-z0-9-]+\?i=([^"&\s]+)/.exec(mail.html)![1]!);
    // Bo opens his invite link on the computer Ana voted from: the page is Bo's, not Ana's.
    const view = await getVoterView(slug, { editToken: ana.editToken, inviteToken: token });
    if (view.status !== 200) throw new Error("view");
    expect(view.view.me).toMatchObject({ name: "Bo Chen", email: "bo@example.com", status: "invited" });
    expect(view.view.prefill).toEqual({ name: "Bo Chen", email: "bo@example.com", locked: true });
    const r = okVote(await vote(slug, { name: "Bo Chen", email: "bo@example.com", votes: [{ optionId: b!, choice: "yes" }] }, { editToken: ana.editToken, inviteToken: token }));
    expect(r.participantId).not.toBe(ana.participantId);
    expect(await votesOf(t.db, ana.participantId)).toMatchObject({ [a!]: "yes", [b!]: "no" });
    expect(await votesOf(t.db, r.participantId)).toMatchObject({ [a!]: "no", [b!]: "yes" });
  });

  it("a signed-in app user votes with their account email, not a typed one", async () => {
    const host = await setupHost(t.db);
    const colleague = await setupHost(t.db, { name: "Kim Lee", email: "kim@example.com", organizationId: host.user.organizationId, orgRole: "user" });
    const { pollId, slug } = await newPoll(host);
    okVote(await vote(slug, { name: "Kim Lee", email: "someone-else@example.com" }, { userId: colleague.user.id }));
    const [p] = await participantsOf(t.db, pollId);
    expect(p).toMatchObject({ email: "kim@example.com", emailNormalized: "kim@example.com", userId: colleague.user.id });
    // Typing an existing voter's email while signed in as someone else changes nothing either.
    const ana = okVote(await vote(slug, { name: "Ana Lima", email: "ana@example.com" }));
    const other = await setupHost(t.db, { name: "Lee Roy", email: "lee@example.com", organizationId: host.user.organizationId, orgRole: "user" });
    const r = okVote(await vote(slug, { name: "Lee Roy", email: "ana@example.com" }, { userId: other.user.id }));
    expect(r.participantId).not.toBe(ana.participantId);
    expect((await participantsOf(t.db, pollId)).map((x) => x.email).sort()).toEqual(["ana@example.com", "kim@example.com", "lee@example.com"]);
  });
});

describe("page states (MP-15)", () => {
  it("unknown slugs answer 404 and expired polls show ended", async () => {
    const host = await setupHost(t.db);
    expect((await getVoterView("nope-nope", {})).status).toBe(404);
    const { slug } = await newPoll(host);
    advance(5 * DAY);
    const v = await getVoterView(slug, {});
    if (v.status !== 200) throw new Error("view");
    expect(v.view.poll.status).toBe("expired");
  });
});
