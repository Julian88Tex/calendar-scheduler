import { describe, expect, it } from "vitest";
import { POLL_ERRORS } from "./constants";
import { dayStart } from "./grid";
import {
  CreatePollSchema,
  SubmitVoteSchema,
  deadlineProblem,
  isMorePublic,
  isValidPollSlug,
  maxVotesProblem,
  normalizeOptions,
  parseRecipientList,
  zPollLocation,
} from "./validation";

const NOW = new Date("2026-10-20T12:00:00Z");
const ctx = { now: NOW, dayStart: (d: string) => new Date(dayStart(d, "America/New_York")) };
const iso = (ms: number) => new Date(ms).toISOString();
const H = 3_600_000;

describe("normalizeOptions (MP-02)", () => {
  it("accepts future timed and date-only options and drops exact duplicates", () => {
    const s = NOW.getTime() + H;
    const r = normalizeOptions(
      [
        { start: iso(s), end: iso(s + 30 * 60_000) },
        { start: iso(s), end: iso(s + 30 * 60_000) },
        { start: iso(s), end: iso(s + 60 * 60_000) }, // overlapping, different end: kept
        { date: "2026-10-22" },
      ],
      ctx,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.options).toHaveLength(3);
      expect(r.options[2]).toMatchObject({ allDayDate: "2026-10-22", durationMinutes: 1440, startsAt: null });
    }
  });

  it("rejects past starts, today's date-only option, bad durations and the 365 day horizon", () => {
    const past = NOW.getTime() - 1;
    expect(normalizeOptions([{ start: iso(past), end: iso(past + 30 * 60_000) }], ctx)).toMatchObject({ ok: false, error: POLL_ERRORS.optionInPast });
    expect(normalizeOptions([{ date: "2026-10-20" }], ctx)).toMatchObject({ ok: false, error: POLL_ERRORS.optionInPast });
    const s = NOW.getTime() + H;
    expect(normalizeOptions([{ start: iso(s), end: iso(s + 4 * 60_000) }], ctx)).toMatchObject({ ok: false, error: POLL_ERRORS.optionDuration });
    expect(normalizeOptions([{ start: iso(s), end: iso(s + 24 * H + 60_000) }], ctx)).toMatchObject({ ok: false, error: POLL_ERRORS.optionDuration });
    expect(normalizeOptions([{ start: iso(s), end: iso(s + 24 * H) }], ctx).ok).toBe(true);
    const far = NOW.getTime() + 366 * 24 * H;
    expect(normalizeOptions([{ start: iso(far), end: iso(far + 30 * 60_000) }], ctx)).toMatchObject({ ok: false, error: POLL_ERRORS.optionTooFar });
  });

  it("caps a poll at 100 options", () => {
    const list = Array.from({ length: 101 }, (_, i) => {
      const s = NOW.getTime() + (i + 1) * H;
      return { start: iso(s), end: iso(s + 30 * 60_000) };
    });
    expect(normalizeOptions(list, ctx)).toMatchObject({ ok: false, error: POLL_ERRORS.tooManyOptions });
    expect(CreatePollSchema.safeParse({ title: "x", timezone: "UTC", defaultDurationMinutes: 30, options: list }).success).toBe(false);
  });
});

describe("rules", () => {
  it("deadline: future and not after the last option start", () => {
    const last = new Date(NOW.getTime() + 48 * H);
    expect(deadlineProblem(null, { now: NOW, lastOptionStart: last })).toBeNull();
    expect(deadlineProblem(NOW, { now: NOW, lastOptionStart: last })).toBe(POLL_ERRORS.deadlinePast);
    expect(deadlineProblem(NOW, { now: NOW, lastOptionStart: last, allowPast: true })).toBeNull();
    expect(deadlineProblem(new Date(last.getTime() + 1), { now: NOW, lastOptionStart: last })).toBe(POLL_ERRORS.deadlineAfterLast);
    expect(deadlineProblem(last, { now: NOW, lastOptionStart: last })).toBeNull();
  });

  it("max votes per option: lower only to the current highest count", () => {
    expect(maxVotesProblem(null, 7)).toBeNull();
    expect(maxVotesProblem(7, 7)).toBeNull();
    expect(maxVotesProblem(6, 7)).toBe("The limit can't be lower than the votes a time already has (7).");
  });

  it("slugs: pattern and reserved words", () => {
    expect(isValidPollSlug("team-sync")).toBe(true);
    expect(isValidPollSlug("ab")).toBe(false);
    expect(isValidPollSlug("-abc")).toBe(false);
    expect(isValidPollSlug("Abc")).toBe(false);
    expect(isValidPollSlug("admin")).toBe(false);
    expect(isValidPollSlug("a".repeat(64))).toBe(true);
    expect(isValidPollSlug("a".repeat(65))).toBe(false);
  });

  it("visibility ordering for the more public warning", () => {
    expect(isMorePublic("host_only", "everyone")).toBe(true);
    expect(isMorePublic("everyone", "counts_only")).toBe(false);
  });

  it("locations: nothing the invitee provides", () => {
    const id = "5eed0000-0000-4000-8000-0000000000a1";
    expect(zPollLocation.safeParse({ id, kind: "google_conference", position: 0 }).success).toBe(true);
    expect(zPollLocation.safeParse({ id, kind: "ask_invitee", position: 0 }).success).toBe(false);
    expect(zPollLocation.safeParse({ id, kind: "outbound_call", position: 0 }).success).toBe(false);
    expect(zPollLocation.safeParse(null).success).toBe(true);
  });

  it("vote payloads: name required, empty email becomes null, choices checked", () => {
    const ok = SubmitVoteSchema.parse({ name: " Ana ", email: "", timezone: "Asia/Kolkata", votes: [] });
    expect(ok).toMatchObject({ name: "Ana", email: null, declined: false });
    expect(SubmitVoteSchema.safeParse({ name: "", timezone: "UTC", votes: [] }).success).toBe(false);
    expect(SubmitVoteSchema.safeParse({ name: "a", timezone: "Mars/Base", votes: [] }).success).toBe(false);
    expect(
      SubmitVoteSchema.safeParse({ name: "a", timezone: "UTC", votes: [{ optionId: "5eed0000-0000-4000-8000-0000000000a1", choice: "maybe" }] }).success,
    ).toBe(false);
  });

  it("pasted recipient lists", () => {
    const r = parseRecipientList("ana@example.com, Bob <bob@example.com>\nnot-an-email; ANA@example.com");
    expect(r.recipients).toEqual([
      { name: null, email: "ana@example.com" },
      { name: "Bob", email: "bob@example.com" },
    ]);
    expect(r.invalid).toEqual(["not-an-email"]);
  });
});
