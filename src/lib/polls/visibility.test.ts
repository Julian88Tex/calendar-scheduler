import { describe, expect, it } from "vitest";
import { canSubscribe, fullOptionIds, redactForVoter, visibilityFlags, type VisInput } from "./visibility";
import type { PollVisibility } from "./types";

function input(visibility: PollVisibility, viewer: VisInput["viewer"] = { participantId: "me", submitted: true }): VisInput {
  return {
    visibility,
    optionIds: ["o1", "o2"],
    participants: [
      { id: "me", name: "Me Myself", status: "responded", votes: { o1: "yes", o2: "no" } },
      { id: "ana", name: "Ana Lima", status: "responded", votes: { o1: "yes", o2: "if_need_be" } },
      { id: "bob", name: "Bob Stone", status: "declined", votes: { o1: "no", o2: "no" } },
      { id: "inv", name: "Invited Ivy", status: "invited", votes: {} },
    ],
    comments: [
      { id: "c1", participantId: "ana", authorUserId: null, authorName: "Ana Lima", body: "Hi", visibility: "public", createdAt: "2026-10-01T00:00:00Z" },
      { id: "c2", participantId: "bob", authorUserId: null, authorName: "Bob Stone", body: "Secret", visibility: "host_only", createdAt: "2026-10-01T00:00:00Z" },
      { id: "c3", participantId: "me", authorUserId: null, authorName: "Me Myself", body: "Mine", visibility: "host_only", createdAt: "2026-10-01T00:00:00Z" },
      { id: "c4", participantId: null, authorUserId: "host", authorName: "Host", body: "Hello all", visibility: "public", createdAt: "2026-10-01T00:00:00Z" },
    ],
    maxVotesPerOption: 2,
    viewer,
  };
}

const json = (v: unknown) => JSON.stringify(v);

describe("redactForVoter (MP-12)", () => {
  it("host_only: no other names, no counts, but Full still enforced", () => {
    const out = redactForVoter(input("host_only"));
    expect(out.participants).toBeNull();
    expect(out.respondentCount).toBeNull();
    expect(out.options.o1).toEqual({ isFull: false, counts: null, voters: null });
    const s = json(out);
    expect(s).not.toContain("Ana Lima");
    expect(s).not.toContain("Bob Stone");
    expect(s).not.toContain("Invited Ivy");
    // Only the viewer's own comment (comments are private messages to the host).
    expect(out.comments.map((c) => c.id)).toEqual(["c3"]);
    expect(out.comments[0]!.canDelete).toBe(true);
  });

  it("Full counts other participants only (the viewer's own selection stays editable)", () => {
    const viewerAna = input("host_only", { participantId: "ana", submitted: true });
    expect(redactForVoter(viewerAna).options.o1!.isFull).toBe(false); // only "me" besides Ana: 1 < 2
    const stranger = input("host_only", { participantId: null, submitted: false });
    expect(redactForVoter(stranger).options.o1!.isFull).toBe(true); // me + ana = 2
    expect(fullOptionIds(["o1"], stranger.participants, null, null).size).toBe(0);
  });

  it("counts_only: counts without names", () => {
    const out = redactForVoter(input("counts_only"));
    expect(out.options.o1!.counts).toEqual({ yes: 2, ifNeedBe: 0 });
    expect(out.options.o2!.counts).toEqual({ yes: 0, ifNeedBe: 1 });
    expect(out.options.o1!.voters).toBeNull();
    expect(out.participants).toBeNull();
    expect(out.respondentCount).toBe(3);
    // Public comments are signed posts; votes stay anonymous.
    expect(json({ ...out, comments: [] })).not.toContain("Ana Lima");
  });

  it("after_vote: nothing before the viewer submits, names afterwards", () => {
    const before = redactForVoter(input("after_vote", { participantId: null, submitted: false }));
    expect(before.participants).toBeNull();
    expect(before.options.o1!.counts).toBeNull();
    // Other voters' comments wait for the viewer's own response too; the host's public comment stays.
    expect(before.comments.map((c) => c.id)).toEqual(["c4"]);
    expect(json(before)).not.toContain("Ana Lima");
    const after = redactForVoter(input("after_vote"));
    expect(after.participants?.map((p) => p.name)).toEqual(["Me Myself", "Ana Lima", "Bob Stone"]);
    expect(after.comments.map((c) => c.id)).toEqual(["c1", "c3", "c4"]);
  });

  it("everyone: names, votes and the grid; invited non-respondents and emails never appear", () => {
    const out = redactForVoter(input("everyone"));
    expect(out.options.o1!.voters).toEqual({ yes: ["Me Myself", "Ana Lima"], ifNeedBe: [] });
    expect(out.participants?.find((p) => p.isYou)?.name).toBe("Me Myself");
    expect(out.participants?.some((p) => p.name === "Invited Ivy")).toBe(false);
    expect(out.participants?.every((p) => !("id" in p) && !("email" in p))).toBe(true);
    // Public comments plus the viewer's own host_only comment; never another voter's host_only comment.
    expect(out.comments.map((c) => c.id)).toEqual(["c1", "c3", "c4"]);
    expect(out.comments.find((c) => c.id === "c4")!.isHost).toBe(true);
  });

  it("flags and subscription offer", () => {
    expect(visibilityFlags("everyone", false)).toEqual({ showNames: true, showCounts: true });
    expect(visibilityFlags("after_vote", false)).toEqual({ showNames: false, showCounts: false });
    expect(visibilityFlags("counts_only", true)).toEqual({ showNames: false, showCounts: true });
    expect(canSubscribe("host_only")).toBe(false);
    expect(canSubscribe("counts_only")).toBe(true);
  });
});
