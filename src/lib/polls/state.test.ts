import { describe, expect, it } from "vitest";
import {
  POLL_EVENTS,
  POLL_STATUSES,
  TransitionError,
  allOptionsPast,
  bookable,
  canTransition,
  effectiveStatus,
  isPastDeadline,
  nextStatus,
  transition,
  votingOpen,
  type PollEvent,
} from "./state";
import type { PollStatus } from "./types";

const ALLOWED: Record<PollEvent, [PollStatus | "new", PollStatus][]> = {
  share: [["new", "open"]],
  close: [["open", "closed"]],
  reopen_voting: [["closed", "open"]],
  book: [
    ["open", "booked"],
    ["closed", "booked"],
  ],
  reopen: [["booked", "open"]],
  expire: [
    ["open", "expired"],
    ["closed", "expired"],
  ],
  delete: [
    ["open", "canceled"],
    ["closed", "canceled"],
    ["expired", "canceled"],
    ["booked", "canceled"],
  ],
  add_future_options: [["expired", "open"]],
};

describe("poll state machine (MP-22)", () => {
  const froms: (PollStatus | "new")[] = ["new", ...POLL_STATUSES];
  for (const event of POLL_EVENTS) {
    for (const from of froms) {
      const allowed = ALLOWED[event].find(([f]) => f === from);
      it(`${event} from ${from} is ${allowed ? `allowed (to ${allowed[1]})` : "forbidden"}`, () => {
        expect(canTransition(from, event)).toBe(Boolean(allowed));
        expect(nextStatus(from, event)).toBe(allowed ? allowed[1] : null);
        if (allowed) expect(transition(from, event)).toBe(allowed[1]);
        else expect(() => transition(from, event)).toThrow(TransitionError);
      });
    }
  }

  it("canceled is final", () => {
    for (const event of POLL_EVENTS) expect(canTransition("canceled", event)).toBe(false);
  });
});

describe("derived flags (lazy guards)", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const later = new Date("2026-10-25T12:00:00Z");

  it("a deadline equal to now has passed", () => {
    expect(isPastDeadline(now, now)).toBe(true);
    expect(isPastDeadline(new Date(now.getTime() + 1), now)).toBe(false);
    expect(isPastDeadline(null, now)).toBe(false);
  });

  it("no options or the last start reached counts as all past", () => {
    expect(allOptionsPast(null, now)).toBe(true);
    expect(allOptionsPast(now, now)).toBe(true);
    expect(allOptionsPast(later, now)).toBe(false);
  });

  it("open past the deadline reads as closed; all options past reads as expired", () => {
    expect(effectiveStatus({ status: "open", deadlineAt: new Date(now.getTime() - 1), lastOptionStart: later, now })).toBe("closed");
    expect(effectiveStatus({ status: "open", deadlineAt: null, lastOptionStart: later, now })).toBe("open");
    expect(effectiveStatus({ status: "open", deadlineAt: null, lastOptionStart: now, now })).toBe("expired");
    expect(effectiveStatus({ status: "closed", deadlineAt: null, lastOptionStart: new Date(0), now })).toBe("expired");
    expect(effectiveStatus({ status: "booked", deadlineAt: null, lastOptionStart: new Date(0), now })).toBe("booked");
    expect(effectiveStatus({ status: "canceled", deadlineAt: null, lastOptionStart: later, now })).toBe("canceled");
  });

  it("voting needs the effective status open; booking open or closed", () => {
    expect(votingOpen({ status: "open", deadlineAt: null, lastOptionStart: later, now })).toBe(true);
    expect(votingOpen({ status: "open", deadlineAt: now, lastOptionStart: later, now })).toBe(false);
    expect(bookable("open")).toBe(true);
    expect(bookable("closed")).toBe(true);
    expect(bookable("booked")).toBe(false);
    expect(bookable("expired")).toBe(false);
    expect(bookable("canceled")).toBe(false);
  });
});
