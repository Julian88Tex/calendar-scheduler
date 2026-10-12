import { describe, expect, it } from "vitest";
import { describeOffset, normalizeOffsets, planAnchorReminders, planInviteReminders, smartLeadReminderMs } from "./reminders";

const H = 3_600_000;
const D = 24 * H;
const INVITED = new Date("2026-10-01T09:00:00Z");

function base(over: Partial<Parameters<typeof planAnchorReminders>[0]> = {}) {
  return {
    mode: "smart" as const,
    offsets: null,
    deadlineAt: null,
    firstFutureOptionStart: null,
    lastOptionStart: new Date(INVITED.getTime() + 60 * D),
    now: INVITED,
    firstInviteSentAt: INVITED,
    ...over,
  };
}

describe("smart lead rule (MP-24 boundaries)", () => {
  it("exactly 5 days is 36 hours before; just over 5 days is 48 hours before", () => {
    expect(smartLeadReminderMs(5 * D)).toBe(36 * H);
    expect(smartLeadReminderMs(5 * D + 1)).toBe(48 * H);
  });

  it("exactly 2 days is 36 hours before; just under 2 days is none", () => {
    expect(smartLeadReminderMs(2 * D)).toBe(36 * H);
    expect(smartLeadReminderMs(2 * D - 1)).toBeNull();
    expect(smartLeadReminderMs(0)).toBeNull();
  });
});

describe("planAnchorReminders", () => {
  it("uses the deadline as the anchor when set", () => {
    const deadline = new Date(INVITED.getTime() + 6 * D);
    const r = planAnchorReminders(base({ deadlineAt: deadline, firstFutureOptionStart: new Date(INVITED.getTime() + 10 * D) }));
    expect(r).toEqual([{ index: 0, kind: "anchor", runAt: new Date(deadline.getTime() - 48 * H) }]);
  });

  it("falls back to the first future option start", () => {
    const first = new Date(INVITED.getTime() + 3 * D);
    const r = planAnchorReminders(base({ firstFutureOptionStart: first }));
    expect(r).toEqual([{ index: 0, kind: "anchor", runAt: new Date(first.getTime() - 36 * H) }]);
  });

  it("no reminder for a lead under 2 days, without invitations, or when off", () => {
    const first = new Date(INVITED.getTime() + 2 * D - 1);
    expect(planAnchorReminders(base({ firstFutureOptionStart: first }))).toEqual([]);
    expect(planAnchorReminders(base({ firstFutureOptionStart: new Date(INVITED.getTime() + 9 * D), firstInviteSentAt: null }))).toEqual([]);
    expect(planAnchorReminders(base({ mode: "off", firstFutureOptionStart: new Date(INVITED.getTime() + 9 * D) }))).toEqual([]);
  });

  it("drops reminders already in the past (recomputed after a deadline change)", () => {
    const deadline = new Date(INVITED.getTime() + 6 * D);
    const r = planAnchorReminders(base({ deadlineAt: deadline, now: new Date(deadline.getTime() - 47 * H) }));
    expect(r).toEqual([]);
  });

  it("custom: before the deadline offsets, sorted, at most 3", () => {
    const deadline = new Date(INVITED.getTime() + 10 * D);
    const r = planAnchorReminders(
      base({
        mode: "custom",
        deadlineAt: deadline,
        offsets: [
          { kind: "before_deadline", minutes: 60 },
          { kind: "before_deadline", minutes: 24 * 60 },
          { kind: "after_invite", minutes: 120 },
        ],
      }),
    );
    expect(r.map((x) => x.runAt.getTime())).toEqual([deadline.getTime() - D, deadline.getTime() - H]);
    expect(planAnchorReminders(base({ mode: "custom", offsets: [{ kind: "before_deadline", minutes: 60 }] }))).toEqual([]);
  });
});

describe("planInviteReminders", () => {
  it("smart: an early nudge 3 days after the invitation when the lead is over 7 days", () => {
    const first = new Date(INVITED.getTime() + 7 * D + 1);
    expect(planInviteReminders({ ...base({ firstFutureOptionStart: first }), invitedAt: INVITED })).toEqual([
      { index: 0, kind: "after_invite", runAt: new Date(INVITED.getTime() + 3 * D) },
    ]);
    const exactly7 = new Date(INVITED.getTime() + 7 * D);
    expect(planInviteReminders({ ...base({ firstFutureOptionStart: exactly7 }), invitedAt: INVITED })).toEqual([]);
  });

  it("custom: after the invitation offsets, dropped after voting closes", () => {
    const deadline = new Date(INVITED.getTime() + 2 * D);
    const r = planInviteReminders({
      ...base({
        mode: "custom",
        deadlineAt: deadline,
        offsets: [
          { kind: "after_invite", minutes: 24 * 60 },
          { kind: "after_invite", minutes: 3 * 24 * 60 },
        ],
      }),
      invitedAt: INVITED,
    });
    expect(r).toEqual([{ index: 0, kind: "after_invite", runAt: new Date(INVITED.getTime() + D) }]);
  });
});

describe("offsets", () => {
  it("normalizes and caps custom offsets", () => {
    expect(
      normalizeOffsets([
        { kind: "after_invite", minutes: 60 },
        { kind: "after_invite", minutes: 60 },
        { kind: "before_deadline", minutes: -5 },
        { kind: "before_deadline", minutes: 30 },
        { kind: "after_invite", minutes: 90 },
        { kind: "after_invite", minutes: 120 },
      ]),
    ).toEqual([
      { kind: "after_invite", minutes: 60 },
      { kind: "before_deadline", minutes: 30 },
      { kind: "after_invite", minutes: 90 },
    ]);
  });

  it("describes offsets", () => {
    expect(describeOffset({ kind: "before_deadline", minutes: 48 * 60 })).toBe("2 days before the deadline");
    expect(describeOffset({ kind: "after_invite", minutes: 60 })).toBe("1 hour after the invitation");
    expect(describeOffset({ kind: "after_invite", minutes: 45 })).toBe("45 minutes after the invitation");
  });
});
