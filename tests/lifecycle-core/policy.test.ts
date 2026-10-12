// Invitee change rules (SPEC CR-02, CR-03, CR-08, SCH-23, MP-21): pure decisions shared by the services and the pages.
import { describe, expect, it } from "vitest";
import { cancelReasonProblem, inviteeCancelBlock, inviteeRescheduleBlock, isRebookable, type ChangeSubject } from "@/lib/lifecycle/policy";

const NOW = new Date("2030-10-07T15:00:00Z");
const H = 3_600_000;

function subject(over: { invitee?: Partial<ChangeSubject["invitee"]>; meeting?: Partial<ChangeSubject["meeting"]>; eventType?: ChangeSubject["eventType"] } = {}): ChangeSubject {
  return {
    invitee: { status: "active", rescheduled: false, newInviteeId: null, metadata: {}, ...over.invitee },
    meeting: { status: "active", startAt: new Date(NOW.getTime() + 72 * H), source: "booking_page", changeCutoffMinutes: null, ...over.meeting },
    eventType: over.eventType === undefined ? { active: true, deletedAt: null, type: "standard" } : over.eventType,
    host: { name: "Julian Joseph", email: "julian@example.com" },
    now: NOW,
  };
}

describe("inviteeCancelBlock", () => {
  it("allows upcoming meetings, even when the event type is off or deleted", () => {
    expect(inviteeCancelBlock(subject())).toBeNull();
    expect(inviteeCancelBlock(subject({ eventType: { active: false, deletedAt: NOW, type: "standard" } }))).toBeNull();
  });
  it("blocks canceled, rescheduled and past meetings with the Calendly copy", () => {
    expect(inviteeCancelBlock(subject({ invitee: { status: "canceled" } }))?.message).toBe("This event has already been canceled.");
    expect(inviteeCancelBlock(subject({ invitee: { status: "canceled", rescheduled: true } }))?.reason).toBe("rescheduled");
    expect(inviteeCancelBlock(subject({ meeting: { startAt: NOW } }))?.message).toBe("This event has already occurred.");
  });
  it("applies the SCH-23 cutoff", () => {
    const block = inviteeCancelBlock(subject({ meeting: { startAt: new Date(NOW.getTime() + 3 * H), changeCutoffMinutes: 24 * 60 } }));
    expect(block).toMatchObject({ reason: "cutoff", message: "This meeting can no longer be changed online. Please contact Julian Joseph.", hostEmail: "julian@example.com" });
    expect(inviteeCancelBlock(subject({ meeting: { startAt: new Date(NOW.getTime() + 25 * H), changeCutoffMinutes: 24 * 60 } }))).toBeNull();
  });
});

describe("inviteeRescheduleBlock", () => {
  const no = "This event can no longer be rescheduled.";
  it("refuses one-off and poll meetings, event types off or deleted, canceled and past meetings", () => {
    expect(inviteeRescheduleBlock(subject())).toBeNull();
    expect(inviteeRescheduleBlock(subject({ meeting: { source: "poll" } }))?.message).toBe(no);
    expect(inviteeRescheduleBlock(subject({ meeting: { source: "one_off" } }))?.message).toBe(no);
    expect(inviteeRescheduleBlock(subject({ eventType: { active: false, deletedAt: null } }))?.message).toBe(no);
    expect(inviteeRescheduleBlock(subject({ eventType: null }))?.message).toBe(no);
    expect(inviteeRescheduleBlock(subject({ invitee: { status: "canceled" } }))?.message).toBe(no);
    expect(inviteeRescheduleBlock(subject({ meeting: { startAt: new Date(NOW.getTime() - H) } }))?.message).toBe(no);
    expect(inviteeRescheduleBlock(subject({ meeting: { startAt: new Date(NOW.getTime() + H), changeCutoffMinutes: 120 } }))?.reason).toBe("cutoff");
  });
  it("lets a canceled invitee pick a new time for 30 days after a request (CR-08)", () => {
    const requested = (daysAgo: number, rebooked: string | null = null) => ({
      status: "canceled" as const,
      metadata: { lifecycle: { cancelKind: "request_reschedule", requestReschedule: { requestedAt: new Date(NOW.getTime() - daysAgo * 24 * H).toISOString(), message: null, reminderDays: null, byUserId: null, rebookedInviteeId: rebooked } } },
    });
    expect(isRebookable(subject({ invitee: requested(2) }))).toBe(true);
    expect(inviteeRescheduleBlock(subject({ invitee: requested(2), meeting: { status: "canceled", startAt: new Date(NOW.getTime() - 24 * H) } }))).toBeNull();
    expect(isRebookable(subject({ invitee: requested(31) }))).toBe(false);
    expect(isRebookable(subject({ invitee: requested(1, "x") }))).toBe(false);
  });
});

describe("cancelReasonProblem", () => {
  it("requires a reason only when asked and caps it at 2,000 characters", () => {
    expect(cancelReasonProblem(null, false)).toBeNull();
    expect(cancelReasonProblem(" ", true)).toBe("Please share a reason for canceling.");
    expect(cancelReasonProblem("x".repeat(2001), false)).toBe("Keep the reason under 2,000 characters.");
  });
});
