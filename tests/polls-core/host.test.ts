// Host management on PGlite (SPEC MP-01, MP-05, MP-16, MP-17, MP-21, MP-22, MP-26, MP-27, MP-32): votes on behalf,
// host-added participants, removal, "?" cells for times added after a response, removing times with votes, co-host
// permissions (creator owner, co-hosts manage, delete creator only), the visibility warning, Close and Reopen voting,
// delete (410), duplicate, CSV export, link ending redirects and the list with its "New" dot.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eventTypeHosts, meetingPollOptions } from "@/db/schema";
import { resetFakeTime, setFakeNow } from "@/lib/time/now";
import { requirePollAccess } from "@/lib/polls/access";
import { duplicatePoll } from "@/lib/polls/create";
import { invitePeople } from "@/lib/polls/invites";
import { closeVoting, deletePoll, reopenVoting } from "@/lib/polls/manage";
import { exportPollCsv, getHostPoll, getVoterView, listPolls } from "@/lib/polls/queries";
import { addOptions, removeOptions, updatePoll } from "@/lib/polls/update";
import { addParticipant, markPollViewed, removeParticipant, setParticipantVotes, updateParticipant } from "@/lib/polls/vote";
import { useTestDb } from "../helpers/db";
import { HOUR, NOW, advance, drain, la, newPoll, opt, outbox, participantsOf, pollRow, setupHost, vote, votesOf } from "./helpers";

const t = useTestDb();
beforeEach(() => setFakeNow(NOW));
afterEach(() => resetFakeTime());

async function optionIds(pollId: string): Promise<string[]> {
  const rows = await t.db.select().from(meetingPollOptions).where(eq(meetingPollOptions.pollId, pollId));
  return rows.filter((o) => !o.deletedAt).sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime()).map((o) => o.id);
}

async function voted(slug: string, over: Parameters<typeof vote>[1] = {}, ctx: Parameters<typeof vote>[2] = {}) {
  const r = await vote(slug, over, ctx);
  if (!r.ok) throw new Error(`vote failed: ${r.code}`);
  return r;
}

describe("participants (MP-17)", () => {
  it("edits votes on behalf (participant emailed), adds a host_added participant and marks people required", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host);
    const [a, b] = await optionIds(pollId);
    const ana = await voted(slug, { votes: [{ optionId: a!, choice: "yes" }] });
    await setParticipantVotes(host.actor, { pollId, participantId: ana.participantId, votes: [{ optionId: b!, choice: "yes" }] });
    expect(await votesOf(t.db, ana.participantId)).toMatchObject({ [a!]: "no", [b!]: "yes" });
    const { participantId } = await addParticipant(host.actor, { pollId, name: "Dev Patel", email: null, votes: [{ optionId: a!, choice: "yes" }] });
    await updateParticipant(host.actor, { pollId, participantId, isRequired: true });
    const all = await participantsOf(t.db, pollId);
    expect(all.find((p) => p.id === participantId)).toMatchObject({ source: "host_added", status: "responded", isRequired: true, createdByUserId: host.user.id });
    await drain(t.db);
    expect(await outbox(t.db, { to: "ana@example.com", template: "polls.votes_edited" })).toHaveLength(1);
    // A host's own vote on behalf does not email that host.
    expect(await outbox(t.db, { to: host.user.email, template: "polls.vote_received" })).toHaveLength(1);
    const view = await getHostPoll(host.actor, pollId);
    expect(view.options.find((o) => o.id === a)?.requiredOk).toBe(true);
    expect(view.options.find((o) => o.id === b)?.requiredOk).toBe(false);
  });

  it("removes a participant: votes deleted, their edit token stops working, they are emailed", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host);
    const [a] = await optionIds(pollId);
    const ana = await voted(slug, { votes: [{ optionId: a!, choice: "yes" }] });
    await removeParticipant(host.actor, { pollId, participantId: ana.participantId });
    expect(await votesOf(t.db, ana.participantId)).toEqual({});
    const view = await getVoterView(slug, { editToken: ana.editToken });
    if (view.status !== 200) throw new Error("view");
    expect(view.view.me).toBeNull();
    await drain(t.db);
    expect((await outbox(t.db, { to: "ana@example.com", template: "polls.removed" }))[0]?.subject).toBe("You were removed from Roadmap sync");
    // The same email can vote again as a new participant.
    expect((await voted(slug)).created).toBe(true);
  });
});

describe("times after publishing (MP-27)", () => {
  it("adds times: existing respondents see '?' and are emailed; an exact duplicate is ignored", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host);
    const ana = await voted(slug);
    advance(HOUR);
    const added = await addOptions(host.actor, { pollId, options: [opt("2030-10-11 09:00"), opt("2030-10-09 10:00")] });
    expect(added).toMatchObject({ added: 1, notified: 1 });
    const view = await getHostPoll(host.actor, pollId);
    expect(view.participants[0]?.unknownOptionIds).toEqual(added.optionIds);
    const voter = await getVoterView(slug, { editToken: ana.editToken });
    if (voter.status !== 200) throw new Error("view");
    expect(voter.view.me?.unknownOptionIds).toEqual(added.optionIds);
    await drain(t.db);
    expect((await outbox(t.db, { to: "ana@example.com", template: "polls.poll_updated" }))[0]?.subject).toBe("New times were added to Roadmap sync");
  });

  it("removes times without votes silently and asks to confirm when people chose them", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host);
    const [a, b] = await optionIds(pollId);
    await voted(slug, { votes: [{ optionId: a!, choice: "yes" }] });
    expect(await removeOptions(host.actor, { pollId, optionIds: [b!] })).toMatchObject({ removed: 1 });
    await expect(removeOptions(host.actor, { pollId, optionIds: [a!] })).rejects.toMatchObject({ code: "conflict", details: { requiresConfirm: true, voters: ["Ana Lima"] } });
    expect(await removeOptions(host.actor, { pollId, optionIds: [a!], confirm: true })).toMatchObject({ removed: 1, votesRemoved: 1 });
    const [last] = await optionIds(pollId);
    await expect(removeOptions(host.actor, { pollId, optionIds: [last!] })).rejects.toMatchObject({ message: "A poll needs at least one time." });
  });
});

describe("co-hosts (MP-01)", () => {
  it("co-hosts view, edit, invite and close; only the creator deletes or removes co-hosts; other orgs see nothing", async () => {
    const host = await setupHost(t.db);
    const co = await setupHost(t.db, { name: "Kim Co", organizationId: host.user.organizationId, orgRole: "user" });
    const peer = await setupHost(t.db, { name: "Pat Peer", organizationId: host.user.organizationId, orgRole: "user" });
    const outsider = await setupHost(t.db, { name: "Out Sider" });
    const { pollId } = await newPoll(host, { coHostIds: [co.user.id, peer.user.id] });
    const hosts = await t.db.select().from(eventTypeHosts).where(eq(eventTypeHosts.eventTypeId, (await pollRow(t.db, pollId)).eventTypeId));
    expect(hosts.map((h) => h.userId).sort()).toEqual([host.user.id, co.user.id, peer.user.id].sort());

    expect((await requirePollAccess(host.actor, pollId)).access).toBe("owner");
    expect((await getHostPoll(co.actor, pollId)).access).toBe("manage");
    await updatePoll(co.actor, { pollId, title: "Roadmap sync v2" });
    await invitePeople(co.actor, { pollId, recipients: [{ email: "bo@example.com" }] });
    await closeVoting(co.actor, pollId);
    await expect(deletePoll(co.actor, { pollId })).rejects.toMatchObject({ code: "forbidden" });
    await expect(updatePoll(co.actor, { pollId, coHostIds: [co.user.id] })).rejects.toMatchObject({ code: "forbidden" });
    await expect(getHostPoll(outsider.actor, pollId)).rejects.toMatchObject({ code: "not_found" });
    await expect(updatePoll(host.actor, { pollId, coHostIds: [outsider.user.id] })).rejects.toMatchObject({ code: "forbidden" });

    const list = await listPolls(co.actor, { filter: "open" });
    expect(list.items.map((p) => [p.id, p.role, p.canDelete])).toEqual([[pollId, "cohost", false]]);
    await updatePoll(host.actor, { pollId, coHostIds: [co.user.id] });
    await expect(getHostPoll(peer.actor, pollId)).rejects.toMatchObject({ code: "not_found" });
    await deletePoll(host.actor, { pollId });
  });
});

describe("settings and lifecycle (MP-22, MP-27)", () => {
  it("warns before revealing names that voters expected hidden", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host);
    await updatePoll(host.actor, { pollId, resultsVisibility: "counts_only" }); // no respondents yet: no warning
    await updatePoll(host.actor, { pollId, resultsVisibility: "host_only" });
    await voted(slug);
    await expect(updatePoll(host.actor, { pollId, resultsVisibility: "everyone" })).rejects.toMatchObject({ details: { requiresConfirm: true }, message: "Voters chose their answers expecting their names to be hidden." });
    await updatePoll(host.actor, { pollId, resultsVisibility: "everyone", confirmPublic: true });
    expect((await pollRow(t.db, pollId)).resultsVisibility).toBe("everyone");
    await expect(updatePoll(host.actor, { pollId, maxVotesPerOption: 0 })).rejects.toBeDefined();
  });

  it("keeps Require email and Verify email consistent (verification implies the email)", async () => {
    const host = await setupHost(t.db);
    const { pollId } = await newPoll(host);
    const flags = async () => {
      const p = await pollRow(t.db, pollId);
      return { requireEmail: p.requireEmail, verifyEmail: p.verifyEmail };
    };
    await updatePoll(host.actor, { pollId, verifyEmail: true });
    expect(await flags()).toEqual({ requireEmail: true, verifyEmail: true });
    // Turning Require email off turns verification off too (it used to leave the email required).
    await updatePoll(host.actor, { pollId, requireEmail: false });
    expect(await flags()).toEqual({ requireEmail: false, verifyEmail: false });
    await updatePoll(host.actor, { pollId, verifyEmail: true });
    expect(await flags()).toEqual({ requireEmail: true, verifyEmail: true });
    await updatePoll(host.actor, { pollId, verifyEmail: false });
    expect(await flags()).toEqual({ requireEmail: true, verifyEmail: false });
    await updatePoll(host.actor, { pollId, requireEmail: false, verifyEmail: true });
    expect(await flags()).toEqual({ requireEmail: true, verifyEmail: true });
  });

  it("closes and reopens voting; a passed deadline must be moved first; a past deadline set by the host closes voting", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host, { deadline: la("2030-10-08 09:00").toISOString() });
    await closeVoting(host.actor, pollId);
    expect((await pollRow(t.db, pollId)).status).toBe("closed");
    await expect(closeVoting(host.actor, pollId)).rejects.toMatchObject({ code: "conflict" });
    expect(await vote(slug)).toMatchObject({ ok: false, code: "closed" });
    advance(26 * HOUR);
    await expect(reopenVoting(host.actor, { pollId })).rejects.toMatchObject({ message: "Move or clear the deadline before reopening voting." });
    await reopenVoting(host.actor, { pollId, deadline: la("2030-10-09 09:00").toISOString() });
    expect((await pollRow(t.db, pollId)).status).toBe("open");
    await voted(slug);
    await updatePoll(host.actor, { pollId, deadline: la("2030-10-08 08:00").toISOString() });
    expect((await pollRow(t.db, pollId)).status).toBe("closed");
  });

  it("deleting answers 410 on the voter page, emails respondents and hides the poll from the list", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host);
    await voted(slug);
    await deletePoll(host.actor, { pollId });
    expect((await getVoterView(slug, {})).status).toBe(410);
    expect(await pollRow(t.db, pollId)).toMatchObject({ status: "canceled" });
    expect((await listPolls(host.actor, { filter: "all" })).items).toEqual([]);
    expect((await listPolls(host.actor, { filter: "deleted" })).items.map((p) => p.id)).toEqual([pollId]);
    await drain(t.db);
    expect((await outbox(t.db, { to: "ana@example.com", template: "polls.canceled" }))[0]?.subject).toBe("Julian Joseph canceled the poll Roadmap sync");
  });

  it("duplicates settings and future times without participants, and exports one CSV row per participant", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host, { allowComments: true, resultsVisibility: "everyone" });
    const [a] = await optionIds(pollId);
    await voted(slug, { votes: [{ optionId: a!, choice: "yes" }], comment: "=SUM(A1)" });
    await invitePeople(host.actor, { pollId, recipients: [{ email: "bo@example.com", name: "Bo" }] });
    const copy = await duplicatePoll(host.actor, pollId);
    expect(await pollRow(t.db, copy.pollId)).toMatchObject({ title: "Roadmap sync (copy)", resultsVisibility: "everyone", allowComments: true });
    expect(await optionIds(copy.pollId)).toHaveLength(3);
    expect(await participantsOf(t.db, copy.pollId)).toEqual([]);
    const { csv, filename } = await exportPollCsv(host.actor, pollId);
    expect(filename).toBe("roadmap-sync-responses.csv");
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Name,Email,Status,Comments,");
    expect(lines[0]).toContain("Wednesday, October 9, 2030, 10:00am - 10:30am");
    expect(lines[1]).toBe("Ana Lima,ana@example.com,Responded,1,Yes,No,No");
    expect(lines[2]).toBe("Bo,bo@example.com,\"Invited, no response\",0,,,");
  });

  it("keeps an old link ending redirecting after a change (MP-05)", async () => {
    const host = await setupHost(t.db);
    const { pollId, slug } = await newPoll(host);
    await updatePoll(host.actor, { pollId, slug: "q4-sync" });
    expect(await getVoterView(slug, {})).toEqual({ status: 301, canonicalSlug: "q4-sync" });
    expect((await getVoterView("q4-sync", {})).status).toBe(200);
    const other = await newPoll(host);
    await expect(updatePoll(host.actor, { pollId: other.pollId, slug })).rejects.toMatchObject({ message: "This link is already taken." });
  });

  it("lists open polls first with the 'New' dot until the host opens the results (MP-26)", async () => {
    const host = await setupHost(t.db);
    const first = await newPoll(host, { title: "First" });
    const second = await newPoll(host, { title: "Second", deadline: la("2030-10-08 12:00").toISOString() });
    await voted(first.slug);
    let list = await listPolls(host.actor, {});
    expect(list.items.map((p) => p.title)).toEqual(["Second", "First"]);
    expect(list.items.find((p) => p.id === first.pollId)).toMatchObject({ hasNew: true, respondents: 1, optionCount: 3, durationMinutes: 30 });
    await markPollViewed(host.actor, first.pollId);
    list = await listPolls(host.actor, { q: "fir" });
    expect(list.items.map((p) => [p.title, p.hasNew])).toEqual([["First", false]]);
    expect(second.pollId).toBeDefined();
  });
});
