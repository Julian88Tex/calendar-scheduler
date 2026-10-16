// Edit wizard save (SPEC MP-27, review regressions): the option writes keep at least one time on the poll and never
// exceed the 100 cap (replacing the only time used to fail with "A poll needs at least one time."), a published time
// removed and put back keeps its id and votes, the server ids of new times map back to the wizard's options after a
// partial save, new times must last 5 minutes to 24 hours, errors on settings inside the collapsed "More settings"
// open it, and the host's "Add participant" / "Edit votes" send every future time like the voter page does.
import { describe, expect, it } from "vitest";
import { futureVotes } from "@/components/polls/lib/answers";
import { diffOptions, durationInRange, fromViews, planOptionSave, savedIdsByKey, timed, type DraftOption } from "@/components/polls/lib/options";
import { errorInMoreSettings } from "@/components/polls/lib/settings";
import { MAX_POLL_OPTIONS } from "@/lib/polls/constants";
import { looksLikeEmail as coreLooksLikeEmail } from "@/lib/polls/validation";
import { looksLikeEmail } from "@/components/polls/lib/email";

const HOUR = 3_600_000;
const T0 = new Date("2026-11-03T14:00:00Z").getTime();
const MIN = 60_000;

function published(n: number): DraftOption[] {
  return fromViews(
    Array.from({ length: n }, (_, i) => ({
      id: `o${i + 1}`,
      start: new Date(T0 + i * HOUR).toISOString(),
      end: new Date(T0 + i * HOUR + HOUR / 2).toISOString(),
      allDayDate: null,
      isPast: false,
    })),
  );
}

/** Applies a plan to a simulated poll and returns the option count after every step. */
function simulate(initialCount: number, steps: ReturnType<typeof planOptionSave>): number[] {
  let count = initialCount;
  return steps.map((s) => (count += s.kind === "remove" ? -s.ids.length : s.options.length));
}

describe("planOptionSave", () => {
  it("removes first, then adds, when some published times stay", () => {
    const added = [timed(T0 + 10 * HOUR, T0 + 11 * HOUR)];
    expect(planOptionSave({ initialCount: 3, removedIds: ["o1", "o2"], added })).toEqual([
      { kind: "remove", ids: ["o1", "o2"] },
      { kind: "add", options: added },
    ]);
    expect(planOptionSave({ initialCount: 3, removedIds: [], added })).toEqual([{ kind: "add", options: added }]);
    expect(planOptionSave({ initialCount: 3, removedIds: ["o3"], added: [] })).toEqual([{ kind: "remove", ids: ["o3"] }]);
    expect(planOptionSave({ initialCount: 3, removedIds: [], added: [] })).toEqual([]);
  });

  it("replacing the only time adds the new one before removing the old one", () => {
    const moved = timed(T0 + 24 * HOUR, T0 + 24 * HOUR + HOUR / 2);
    const steps = planOptionSave({ initialCount: 1, removedIds: ["o1"], added: [moved] });
    expect(steps).toEqual([
      { kind: "add", options: [moved] },
      { kind: "remove", ids: ["o1"] },
    ]);
    expect(Math.min(...simulate(1, steps))).toBeGreaterThanOrEqual(1);
  });

  it("replacing every time never leaves the poll empty or over the cap", () => {
    const fresh = Array.from({ length: MAX_POLL_OPTIONS }, (_, i) => timed(T0 + (200 + i) * HOUR, T0 + (200 + i) * HOUR + HOUR / 2));
    const ids = published(MAX_POLL_OPTIONS).map((o) => o.id!);
    const steps = planOptionSave({ initialCount: MAX_POLL_OPTIONS, removedIds: ids, added: fresh });
    const counts = simulate(MAX_POLL_OPTIONS, steps);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...counts)).toBeLessThanOrEqual(MAX_POLL_OPTIONS);
    expect(counts.at(-1)).toBe(MAX_POLL_OPTIONS);
    // Every removal and every new time is written exactly once.
    expect(steps.flatMap((s) => (s.kind === "remove" ? s.ids : [])).sort()).toEqual([...ids].sort());
    expect(steps.flatMap((s) => (s.kind === "add" ? s.options : []))).toHaveLength(MAX_POLL_OPTIONS);
  });

  it("removing every time without new ones is left to the server's 'at least one time' rule", () => {
    expect(planOptionSave({ initialCount: 2, removedIds: ["o1", "o2"], added: [] })).toEqual([{ kind: "remove", ids: ["o1", "o2"] }]);
  });
});

describe("diffOptions", () => {
  it("keeps a published time that was removed and put back (same id, same votes)", () => {
    const initial = published(2);
    const again = timed(initial[0]!.kind === "timed" ? initial[0]!.start : 0, initial[0]!.kind === "timed" ? initial[0]!.end : 0);
    expect(diffOptions(initial, [initial[1]!, again])).toEqual({ removedIds: [], added: [] });
    const other = timed(T0 + 50 * HOUR, T0 + 51 * HOUR);
    expect(diffOptions(initial, [again, other])).toEqual({ removedIds: ["o2"], added: [other] });
  });
});

describe("savedIdsByKey", () => {
  it("maps the server's ids in insert order, skipping duplicates and times the poll already had", () => {
    const a = timed(T0, T0 + HOUR);
    const b = timed(T0 + 2 * HOUR, T0 + 3 * HOUR);
    const c = timed(T0 + 4 * HOUR, T0 + 5 * HOUR);
    const ids = savedIdsByKey([a, b, a, c], ["id-a", "id-c"], new Set([b.key]));
    expect([...ids.entries()]).toEqual([
      [a.key, "id-a"],
      [c.key, "id-c"],
    ]);
    expect(savedIdsByKey([a], [], new Set()).size).toBe(0);
  });
});

describe("durationInRange", () => {
  it("accepts 5 minutes to 24 hours and any all-day date", () => {
    expect(durationInRange(timed(T0, T0 + 5 * MIN))).toBe(true);
    expect(durationInRange(timed(T0, T0 + 24 * HOUR))).toBe(true);
    expect(durationInRange(timed(T0, T0 + 2 * MIN))).toBe(false);
    expect(durationInRange(timed(T0, T0 + 24 * HOUR + 5 * MIN))).toBe(false);
    expect(durationInRange({ kind: "date", key: "d:2026-11-04", date: "2026-11-04" })).toBe(true);
  });
});

describe("errorInMoreSettings", () => {
  it("is true only for fields inside More settings", () => {
    expect(errorInMoreSettings({ deadline: ["The deadline can't be after the last proposed time."] })).toBe(true);
    expect(errorInMoreSettings({ "reminderOffsets.0.minutes": ["Too long"] })).toBe(true);
    expect(errorInMoreSettings({ maxChoicesPerParticipant: ["Use 3 or fewer."] })).toBe(true);
    expect(errorInMoreSettings({ title: ["Enter a name."], location: ["x"], "options.2": ["Past"] })).toBe(false);
    expect(errorInMoreSettings({ deadline: [] })).toBe(false);
  });
});

describe("futureVotes", () => {
  it("sends every future time, No when untouched, never a started one", () => {
    const options = [
      { id: "past", isPast: true },
      { id: "a", isPast: false },
      { id: "b", isPast: false },
    ];
    expect(futureVotes(options, { past: "yes", a: "if_need_be" })).toEqual([
      { optionId: "a", choice: "if_need_be" },
      { optionId: "b", choice: "no" },
    ]);
  });
});

describe("voter page email check", () => {
  it("matches polls-core's looksLikeEmail without bundling its schemas", () => {
    for (const v of ["a@b.co", "priya.raman+polls@example.com", "a@b", "a b@c.de", "<x>@y.com", "x@y.c", "", "@example.com", "名前@例え.jp"]) {
      expect(looksLikeEmail(v), v).toBe(coreLooksLikeEmail(v));
    }
  });
});
