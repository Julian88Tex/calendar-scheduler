// Wizard options and voter answers (SPEC MP-02, MP-08, MP-27): the exact duplicate toggle, the 100 times cap, frozen
// started options, move and merge, the edit diff, the stored draft; the Yes / If need be / No cycle, its ARIA state,
// full options, "Max choices per participant" and the radio list.
import { describe, expect, it } from "vitest";
import { applyChoice, ariaChecked, countAttending, nextChoice, selectState, votesPayload } from "@/components/polls/lib/answers";
import { draftOptions, parseDraft, storedOptions } from "@/components/polls/lib/draft";
import { addOptions, allDay, diffOptions, dropPast, fromViews, overlapping, replaceOption, sortOptions, timed, toggleOption, toInput } from "@/components/polls/lib/options";
import { MAX_POLL_OPTIONS } from "@/lib/polls/constants";

const NY = "America/New_York";
const HOUR = 3_600_000;
const T0 = new Date("2026-10-20T14:00:00Z").getTime();

describe("wizard options", () => {
  it("toggles an exact duplicate off and keeps a different overlapping time", () => {
    const a = timed(T0, T0 + HOUR / 2);
    let r = toggleOption([], a);
    expect(r.change).toBe("added");
    r = toggleOption(r.list, timed(T0 + HOUR / 4, T0 + (3 * HOUR) / 4));
    expect(r.change).toBe("added");
    expect(r.list).toHaveLength(2);
    r = toggleOption(r.list, timed(T0, T0 + HOUR / 2));
    expect(r.change).toBe("removed");
    expect(r.list.map((o) => o.key)).toEqual([timed(T0 + HOUR / 4, T0 + (3 * HOUR) / 4).key]);
  });

  it("refuses the 101st time and never removes a started option", () => {
    const full = Array.from({ length: MAX_POLL_OPTIONS }, (_, i) => timed(T0 + i * HOUR, T0 + i * HOUR + HOUR / 2));
    expect(toggleOption(full, timed(T0 - HOUR, T0)).change).toBe("full");
    const added = addOptions(full.slice(0, 98), [full[0]!, timed(T0 - 2 * HOUR, T0 - HOUR), timed(T0 - 3 * HOUR, T0 - 2 * HOUR), timed(T0 - 4 * HOUR, T0 - 3 * HOUR)]);
    expect(added).toMatchObject({ added: 2, full: true });
    expect(added.list).toHaveLength(MAX_POLL_OPTIONS);
    const frozen = { ...timed(T0, T0 + HOUR), id: "o1", frozen: true };
    expect(toggleOption([frozen], timed(T0, T0 + HOUR)).change).toBe("frozen");
  });

  it("merges a moved option into an identical one and keeps its position otherwise", () => {
    const a = timed(T0, T0 + HOUR);
    const b = timed(T0 + 2 * HOUR, T0 + 3 * HOUR);
    const c = timed(T0 + 4 * HOUR, T0 + 5 * HOUR);
    expect(replaceOption([a, b, c], b.key, timed(T0 + 6 * HOUR, T0 + 7 * HOUR)).map((o) => o.kind === "timed" && o.start)).toEqual([T0, T0 + 6 * HOUR, T0 + 4 * HOUR]);
    expect(replaceOption([a, b, c], b.key, a)).toEqual([a, c]);
  });

  it("sorts all-day dates before the times of that day and serializes both kinds", () => {
    const day = allDay("2026-10-20");
    const sorted = sortOptions([timed(T0, T0 + HOUR), day], NY);
    expect(sorted[0]).toBe(day);
    expect(toInput(day)).toEqual({ date: "2026-10-20" });
    expect(toInput(timed(T0, T0 + HOUR))).toEqual({ start: "2026-10-20T14:00:00.000Z", end: "2026-10-20T15:00:00.000Z" });
  });

  it("diffs an edit into removed ids and new times, with started options frozen", () => {
    const initial = fromViews([
      { id: "o1", start: "2026-10-20T14:00:00.000Z", end: "2026-10-20T15:00:00.000Z", allDayDate: null, isPast: true },
      { id: "o2", start: "2026-10-21T14:00:00.000Z", end: "2026-10-21T15:00:00.000Z", allDayDate: null, isPast: false },
      { id: "o3", start: null, end: null, allDayDate: "2026-10-22", isPast: false },
    ]);
    expect(initial[0]).toMatchObject({ id: "o1", frozen: true });
    expect(initial[2]).toMatchObject({ kind: "date", date: "2026-10-22" });
    const added = timed(T0 + 48 * HOUR, T0 + 49 * HOUR);
    const diff = diffOptions(initial, [initial[0]!, initial[2]!, added]);
    expect(diff).toEqual({ removedIds: ["o2"], added: [added] });
  });

  it("drops new times that started and flags overlaps with busy blocks", () => {
    const list = [timed(T0 - HOUR, T0), { ...timed(T0 - 2 * HOUR, T0 - HOUR), id: "kept" }, timed(T0 + HOUR, T0 + 2 * HOUR)];
    expect(dropPast(list, NY, T0).map((o) => o.key)).toEqual([list[1]!.key, list[2]!.key]);
    const busy = [{ start: T0 + 90 * 60_000, end: T0 + 3 * HOUR, title: "Standup" }];
    expect(overlapping({ start: T0 + HOUR, end: T0 + 2 * HOUR }, busy)?.title).toBe("Standup");
    expect(overlapping({ start: T0, end: T0 + HOUR }, busy)).toBeNull();
  });
});

describe("stored draft", () => {
  const draft = {
    userId: "u1",
    savedAt: T0,
    timezone: NY,
    duration: { kind: "minutes", minutes: 45 },
    options: [{ start: T0 + HOUR, end: T0 + 2 * HOUR }, { date: "2026-10-22" }, { start: T0 - 2 * HOUR, end: T0 - HOUR }, { start: 5, end: 1 }, "junk"],
    title: "Planning",
    descriptionHtml: "<p>Agenda</p>",
    location: null,
    settings: { allowIfNeedBe: true },
  };

  it("parses a recent draft of the same user and drops malformed and started times", () => {
    const parsed = parseDraft(JSON.stringify(draft), "u1", T0);
    expect(parsed).toMatchObject({ title: "Planning", duration: { kind: "minutes", minutes: 45 }, timezone: NY });
    expect(parsed!.options).toHaveLength(3);
    expect(draftOptions(parsed!, T0).map((o) => o.key)).toEqual([timed(T0 + HOUR, T0 + 2 * HOUR).key, allDay("2026-10-22").key]);
  });

  it("ignores another user's, stale, broken or bad zone drafts and falls back to 30 minutes", () => {
    expect(parseDraft(JSON.stringify(draft), "u2", T0)).toBeNull();
    expect(parseDraft(JSON.stringify(draft), "u1", T0 + 31 * 86_400_000)).toBeNull();
    expect(parseDraft("{not json", "u1", T0)).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, timezone: "Mars/Olympus" }), "u1", T0)).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, duration: { kind: "minutes", minutes: 2 } }), "u1", T0)!.duration).toEqual({ kind: "minutes", minutes: 30 });
  });

  it("stores only the new times of the wizard", () => {
    expect(storedOptions([timed(T0, T0 + HOUR), { ...allDay("2026-10-23"), id: "x" }, allDay("2026-10-24")])).toEqual([{ start: T0, end: T0 + HOUR }, { date: "2026-10-24" }]);
  });
});

describe("voter answers", () => {
  it("cycles No, Yes, If need be when If need be is on, else No and Yes", () => {
    expect(nextChoice(undefined, true)).toBe("yes");
    expect(nextChoice("yes", true)).toBe("if_need_be");
    expect(nextChoice("if_need_be", true)).toBe("no");
    expect(nextChoice("yes", false)).toBe("no");
    expect([ariaChecked("yes"), ariaChecked("if_need_be"), ariaChecked("no"), ariaChecked(undefined)]).toEqual(["true", "mixed", "false", "false"]);
  });

  it("blocks past options, new picks of full options and picks beyond the max choices", () => {
    const base = { optionId: "a", isPast: false, isFull: false, current: {}, stored: {}, maxChoices: null, next: "yes" as const };
    expect(selectState({ ...base, isPast: true })).toEqual({ disabled: true, reason: "Past" });
    expect(selectState({ ...base, isFull: true }).disabled).toBe(true);
    // The voter's own stored pick of a full option can be removed and put back.
    expect(selectState({ ...base, isFull: true, stored: { a: "yes" } }).disabled).toBe(false);
    expect(selectState({ ...base, isFull: true, next: "no" }).disabled).toBe(false);
    const two = { b: "yes" as const, c: "if_need_be" as const };
    expect(selectState({ ...base, maxChoices: 2, current: two }).disabled).toBe(true);
    expect(selectState({ ...base, optionId: "b", maxChoices: 2, current: two, next: "if_need_be" }).disabled).toBe(false);
    expect(countAttending({ ...two, d: "no" })).toBe(2);
  });

  it("replaces the previous pick in a radio list and sends every future option", () => {
    expect(applyChoice({ a: "yes", b: "no" }, "b", "yes", 1)).toEqual({ a: "no", b: "yes" });
    expect(applyChoice({ a: "yes" }, "b", "yes", null)).toEqual({ a: "yes", b: "yes" });
    expect(votesPayload({ a: "if_need_be" }, ["a", "b"])).toEqual([
      { optionId: "a", choice: "if_need_be" },
      { optionId: "b", choice: "no" },
    ]);
  });
});
