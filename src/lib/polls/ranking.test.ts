import { describe, expect, it } from "vitest";
import { consensusOptions, rankPollOptions, type RankOption, type RankParticipant, type RankVote } from "./ranking";
import type { VoteChoice } from "./types";

const NOW = new Date("2026-10-20T12:00:00Z").getTime();
const H = 3_600_000;

function opts(n: number): RankOption[] {
  return Array.from({ length: n }, (_, i) => ({ id: `o${i + 1}`, start: NOW + (i + 1) * H }));
}

function people(...specs: { id: string; status?: RankParticipant["status"]; required?: boolean }[]): RankParticipant[] {
  return specs.map((s) => ({ id: s.id, status: s.status ?? "responded", isRequired: s.required ?? false }));
}

function votes(map: Record<string, Record<string, VoteChoice>>): RankVote[] {
  return Object.entries(map).flatMap(([participantId, v]) => Object.entries(v).map(([optionId, choice]) => ({ participantId, optionId, choice })));
}

describe("rankPollOptions (MP-28)", () => {
  it("sorts by attendable, then yes, and stars the top tie group", () => {
    const o = opts(3);
    const p = people({ id: "a" }, { id: "b" }, { id: "c" });
    const v = votes({
      a: { o1: "yes", o2: "yes", o3: "no" },
      b: { o1: "if_need_be", o2: "yes", o3: "yes" },
      c: { o1: "yes", o2: "no", o3: "if_need_be" },
    });
    const r = rankPollOptions(o, v, p, [], NOW);
    // o1: attendable 3 (2 yes); o2: 2 (2 yes); o3: 2 (1 yes)
    expect(r.map((x) => x.id)).toEqual(["o1", "o2", "o3"]);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3]);
    expect(r.filter((x) => x.isBest).map((x) => x.id)).toEqual(["o1"]);
    expect(r[0]).toMatchObject({ yes: 2, ifNeedBe: 1, no: 0, unknown: 0, attendable: 3 });
  });

  it("ties on the first five keys share the Best star; start breaks the order", () => {
    const o = opts(3);
    const p = people({ id: "a" });
    const v = votes({ a: { o1: "yes", o2: "yes", o3: "no" } });
    const r = rankPollOptions(o, v, p, [], NOW);
    expect(r.map((x) => x.id)).toEqual(["o1", "o2", "o3"]);
    expect(r.filter((x) => x.isBest).map((x) => x.id)).toEqual(["o1", "o2"]);
  });

  it("required participants come first: requiredOk beats more attendees", () => {
    const o = opts(2);
    const p = people({ id: "boss", required: true }, { id: "x" }, { id: "y" });
    const v = votes({ boss: { o1: "no", o2: "if_need_be" }, x: { o1: "yes", o2: "no" }, y: { o1: "yes", o2: "no" } });
    const r = rankPollOptions(o, v, p, [], NOW);
    expect(r[0]!.id).toBe("o2");
    expect(r[0]!.requiredOk).toBe(true);
    expect(r[1]!.requiredOk).toBe(false);
  });

  it("a required participant who has not answered makes requiredOk false everywhere", () => {
    const o = opts(2);
    const p = people({ id: "boss", status: "invited", required: true }, { id: "x" });
    const v = votes({ x: { o1: "yes", o2: "yes" } });
    const r = rankPollOptions(o, v, p, [], NOW);
    expect(r.every((x) => !x.requiredOk)).toBe(true);
    expect(r[0]!.yes).toBe(1);
  });

  it("host conflicts lose ties but not against more attendees", () => {
    const o = opts(3);
    const p = people({ id: "a" }, { id: "b" });
    const v = votes({ a: { o1: "yes", o2: "yes", o3: "yes" }, b: { o1: "yes", o2: "yes", o3: "no" } });
    const r = rankPollOptions(o, v, p, new Set(["o1"]), NOW);
    expect(r.map((x) => x.id)).toEqual(["o2", "o1", "o3"]);
    expect(r[1]!.hostFree).toBe(false);
    expect(r.filter((x) => x.isBest).map((x) => x.id)).toEqual(["o2"]);
  });

  it("fewer No answers win when everything else ties", () => {
    const o = opts(2);
    const p = people({ id: "a" }, { id: "b" });
    const v = votes({ a: { o1: "yes", o2: "yes" }, b: { o1: "no" } });
    const r = rankPollOptions(o, v, p, [], NOW);
    expect(r[0]!.id).toBe("o2");
    expect(r[0]!.unknown).toBe(1); // b never answered o2 ("?")
  });

  it("past options follow without rank or star", () => {
    const o: RankOption[] = [{ id: "past", start: NOW - H }, ...opts(1)];
    const p = people({ id: "a" });
    const v = votes({ a: { past: "yes", o1: "no" } });
    const r = rankPollOptions(o, v, p, [], NOW);
    expect(r.map((x) => x.id)).toEqual(["o1", "past"]);
    expect(r[1]).toMatchObject({ isPast: true, rank: null, isBest: false });
  });

  it("no badge when nobody has responded; invited people do not count", () => {
    const o = opts(2);
    const p = people({ id: "a", status: "invited" });
    const r = rankPollOptions(o, [], p, [], NOW);
    expect(r.some((x) => x.isBest)).toBe(false);
    expect(r[0]).toMatchObject({ yes: 0, no: 0, unknown: 0 });
  });

  it("an empty poll ranks nothing", () => {
    expect(rankPollOptions([], [], [], [], NOW)).toEqual([]);
  });

  it("declined participants count with all No", () => {
    const o = opts(1);
    const p = people({ id: "a", status: "declined" });
    const r = rankPollOptions(o, votes({ a: { o1: "no" } }), p, [], NOW);
    expect(r[0]!.no).toBe(1);
    expect(r[0]!.isBest).toBe(true);
  });

  it("the host preference counts only when countHostPreference is on", () => {
    const o = opts(2);
    const p = people({ id: "a" });
    const v = votes({ a: { o1: "yes", o2: "yes" } });
    const off = rankPollOptions(o, v, p, [], NOW, { hostPreference: { o2: "yes" } });
    expect(off[0]!.id).toBe("o1");
    const on = rankPollOptions(o, v, p, [], NOW, { hostPreference: { o2: "yes" }, countHostPreference: true });
    expect(on[0]!.id).toBe("o2");
    expect(on[0]!.yes).toBe(2);
  });
});

describe("consensusOptions (MP-31)", () => {
  const invited = (id: string, status: RankParticipant["status"] = "responded", required = false) => ({ id, status, isRequired: required, invited: true });

  it("books the earliest option where every invited participant said Yes", () => {
    const o = opts(3);
    const p = [invited("a"), invited("b")];
    const v = votes({ a: { o1: "yes", o2: "yes", o3: "yes" }, b: { o1: "if_need_be", o2: "yes", o3: "yes" } });
    expect(consensusOptions(o, v, p, [], NOW)).toEqual(["o2", "o3"]);
  });

  it("waits until every relevant participant responded", () => {
    const o = opts(1);
    const p = [invited("a"), invited("b", "invited")];
    expect(consensusOptions(o, votes({ a: { o1: "yes" } }), p, [], NOW)).toEqual([]);
  });

  it("required participants replace the invited set when any are marked", () => {
    const o = opts(1);
    const p = [invited("a", "responded", true), invited("b", "invited")];
    expect(consensusOptions(o, votes({ a: { o1: "yes" } }), p, [], NOW)).toEqual(["o1"]);
  });

  it("never picks an option where a host is busy, and needs someone relevant", () => {
    const o = opts(1);
    expect(consensusOptions(o, votes({ a: { o1: "yes" } }), [invited("a")], ["o1"], NOW)).toEqual([]);
    expect(consensusOptions(o, [], [], [], NOW)).toEqual([]);
  });
});
