// The NT-15 timing rules of computeExecutions for every trigger and edge case (pure, no database).
import { describe, expect, it } from "vitest";
import {
  computeExecutions,
  currentRunAt,
  executionIdempotencyKey,
  executionRunAt,
  stepSnapshot,
  type EngineInvitee,
  type EngineMeeting,
  type EngineStep,
  type EngineWorkflow,
  type WorkflowTrigger,
} from "./engine";

const NOW = new Date("2030-10-07T12:00:00Z");
const min = (n: number) => n * 60_000;
const at = (offsetMinutes: number) => new Date(NOW.getTime() + min(offsetMinutes));

function wf(trigger: WorkflowTrigger, offsetMinutes = 0, extra: Partial<EngineWorkflow> = {}): EngineWorkflow {
  return { id: "wf-1", name: "Reminder", trigger, offsetMinutes, isBasic: false, ...extra };
}

function step(id: string, action: EngineStep["action"] = "email_invitees", position = 0): EngineStep {
  return {
    id,
    position,
    action,
    recipients: action === "email_other" ? ["assistant@example.com"] : [],
    subject: "Reminder: {{event_name}}",
    bodyHtml: "<p>See you soon.</p>",
    bodyText: null,
    includeCancelRescheduleLinks: true,
    includeGuests: false,
    replyTo: null,
  };
}

// A 30 minute meeting 3 days from NOW.
const meeting: EngineMeeting = { id: "ev-1", startAt: at(3 * 1440), endAt: at(3 * 1440 + 30), isGroup: false, status: "active" };
const invitee: EngineInvitee = { id: "inv-1", status: "active", createdAt: at(-5) };

describe("run times per trigger", () => {
  it("before_start = start - offset, starts = start + offset, ends = end + offset", () => {
    expect(executionRunAt("before_start", 1440, meeting, { now: NOW })).toEqual(at(2 * 1440));
    expect(executionRunAt("starts", 10, meeting, { now: NOW })).toEqual(at(3 * 1440 + 10));
    expect(executionRunAt("ends", 15, meeting, { now: NOW })).toEqual(at(3 * 1440 + 45));
  });

  it("booked = booking time + offset; rescheduled, canceled and no_show = change time + offset", () => {
    expect(executionRunAt("booked", 60, meeting, { now: NOW, bookedAt: at(-5) })).toEqual(at(55));
    expect(executionRunAt("booked", 0, meeting, { now: NOW })).toEqual(NOW);
    for (const t of ["rescheduled", "canceled", "no_show"] as const) {
      expect(executionRunAt(t, 30, meeting, { now: NOW, eventAt: at(-1) })).toEqual(at(29));
      expect(executionRunAt(t, 0, meeting, { now: NOW })).toEqual(NOW);
    }
  });

  it("currentRunAt follows the meeting for timed triggers only", () => {
    const moved = { startAt: at(5 * 1440), endAt: at(5 * 1440 + 60) };
    expect(currentRunAt("before_start", 60, moved)).toEqual(at(5 * 1440 - 60));
    expect(currentRunAt("ends", 0, moved)).toEqual(at(5 * 1440 + 60));
    expect(currentRunAt("booked", 0, moved)).toBeNull();
    expect(currentRunAt("canceled", 0, moved)).toBeNull();
  });
});

describe("computeExecutions", () => {
  it("creates one scheduled execution per action and invitee with a snapshot and a run-time-free key", () => {
    const w = wf("before_start", 1440);
    const steps = [step("s1"), step("s2", "email_host", 1)];
    const out = computeExecutions(w, steps, meeting, [invitee], "before_start", { now: NOW });
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.stepId)).toEqual(["s1", "s2"]);
    for (const e of out) {
      expect(e.status).toBe("scheduled");
      expect(e.skipReason).toBeNull();
      expect(e.inviteeId).toBe("inv-1");
      expect(e.runAt).toEqual(at(2 * 1440));
      expect(e.idempotencyKey).toBe(`${e.stepId}:inv-1:before_start`);
      expect(e.idempotencyKey).not.toContain(String(e.runAt.getTime()));
    }
    expect(out[0]!.snapshot).toEqual({
      workflowName: "Reminder",
      trigger: "before_start",
      offsetMinutes: 1440,
      action: "email_invitees",
      recipients: [],
      subject: "Reminder: {{event_name}}",
      bodyHtml: "<p>See you soon.</p>",
      bodyText: null,
      includeCancelRescheduleLinks: true,
      includeGuests: false,
      replyTo: null,
      isBasic: false,
    });
  });

  it("only runs for the workflow's own trigger", () => {
    expect(computeExecutions(wf("ends", 15), [step("s1")], meeting, [invitee], "before_start", { now: NOW })).toEqual([]);
  });

  it("skips a before-start reminder booked too close (run time already passed)", () => {
    const soon: EngineMeeting = { ...meeting, startAt: at(120), endAt: at(150) };
    const [e] = computeExecutions(wf("before_start", 1440), [step("s1")], soon, [invitee], "before_start", { now: NOW });
    expect(e).toMatchObject({ status: "skipped", skipReason: "booked_too_close", runAt: at(120 - 1440) });
    // Exactly at the boundary counts as too close.
    const edge: EngineMeeting = { ...meeting, startAt: at(1440), endAt: at(1470) };
    expect(computeExecutions(wf("before_start", 1440), [step("s1")], edge, [invitee], "before_start", { now: NOW })[0]?.status).toBe("skipped");
  });

  it("schedules other past run times to run immediately", () => {
    const past: EngineMeeting = { ...meeting, startAt: at(-90), endAt: at(-30) };
    const [e] = computeExecutions(wf("ends", 15), [step("s1")], past, [invitee], "ends", { now: NOW });
    expect(e).toMatchObject({ status: "scheduled", runAt: at(-15) });
    const [b] = computeExecutions(wf("booked", 0), [step("s1")], meeting, [invitee], "booked", { now: NOW });
    expect(b).toMatchObject({ status: "scheduled", runAt: at(-5) });
  });

  it("ignores canceled invitees except for the canceled trigger", () => {
    const gone: EngineInvitee = { ...invitee, status: "canceled" };
    expect(computeExecutions(wf("before_start", 60), [step("s1")], meeting, [gone], "before_start", { now: NOW })).toEqual([]);
    const canceledMeeting: EngineMeeting = { ...meeting, status: "canceled" };
    const out = computeExecutions(wf("canceled", 0), [step("s1")], canceledMeeting, [gone], "canceled", { now: NOW, eventAt: at(-1) });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ inviteeId: "inv-1", runAt: at(-1), status: "scheduled", idempotencyKey: "s1:inv-1:canceled" });
  });

  it("never schedules for canceled meetings (except the canceled trigger)", () => {
    const canceledMeeting: EngineMeeting = { ...meeting, status: "canceled" };
    expect(computeExecutions(wf("before_start", 60), [step("s1")], canceledMeeting, [invitee], "before_start", { now: NOW })).toEqual([]);
  });

  it("never creates canceled-trigger executions for group events", () => {
    const group: EngineMeeting = { ...meeting, isGroup: true };
    expect(
      computeExecutions(wf("canceled", 0), [step("s1")], group, [{ ...invitee, status: "canceled" }], "canceled", { now: NOW }),
    ).toEqual([]);
  });

  it("skips one-off meetings and poll meetings entirely (Calendly parity)", () => {
    expect(computeExecutions(wf("before_start", 60), [step("s1")], { ...meeting, pollId: "p" }, [invitee], "before_start", { now: NOW })).toEqual([]);
    expect(
      computeExecutions(wf("before_start", 60), [step("s1")], { ...meeting, oneOffMeetingId: "o" }, [invitee], "before_start", { now: NOW }),
    ).toEqual([]);
  });

  it("group events: one execution per invitee for invitee actions, one per slot for host and other actions", () => {
    const group: EngineMeeting = { ...meeting, isGroup: true };
    const people: EngineInvitee[] = [invitee, { id: "inv-2", status: "active", createdAt: at(-3) }, { id: "inv-3", status: "canceled", createdAt: at(-2) }];
    const out = computeExecutions(wf("before_start", 60), [step("s1"), step("s2", "email_host", 1), step("s3", "email_other", 2)], group, people, "before_start", {
      now: NOW,
    });
    expect(out.filter((e) => e.stepId === "s1").map((e) => e.inviteeId)).toEqual(["inv-1", "inv-2"]);
    expect(out.filter((e) => e.stepId === "s2")).toEqual([expect.objectContaining({ inviteeId: null, idempotencyKey: "s2:slot:ev-1:before_start" })]);
    expect(out.filter((e) => e.stepId === "s3")).toEqual([expect.objectContaining({ inviteeId: null })]);
  });

  it("group events: host actions of event-driven triggers stay per invitee", () => {
    const group: EngineMeeting = { ...meeting, isGroup: true };
    const out = computeExecutions(wf("booked", 0), [step("s2", "email_host")], group, [invitee], "booked", { now: NOW });
    expect(out).toEqual([expect.objectContaining({ inviteeId: "inv-1", idempotencyKey: "s2:inv-1:booked" })]);
  });

  it("group events: text actions are skipped above 100 invitees", () => {
    const group: EngineMeeting = { ...meeting, isGroup: true, activeInviteeCount: 101 };
    const [e] = computeExecutions(wf("before_start", 60), [step("s1", "sms_invitees")], group, [invitee], "before_start", { now: NOW });
    expect(e).toMatchObject({ status: "skipped", skipReason: "group_too_large" });
    const ok = computeExecutions(wf("before_start", 60), [step("s1", "sms_invitees")], { ...group, activeInviteeCount: 100 }, [invitee], "before_start", { now: NOW });
    expect(ok[0]?.status).toBe("scheduled");
  });

  it("orders steps by position", () => {
    const out = computeExecutions(wf("before_start", 60), [step("b", "email_host", 1), step("a", "email_invitees", 0)], meeting, [invitee], "before_start", { now: NOW });
    expect(out.map((e) => e.stepId)).toEqual(["a", "b"]);
  });

  describe("backfill mode", () => {
    it("covers before_start, starts and ends only", () => {
      for (const t of ["booked", "rescheduled", "canceled", "no_show"] as const) {
        expect(computeExecutions(wf(t, 0), [step("s1")], meeting, [invitee], t, { now: NOW, backfill: true })).toEqual([]);
      }
      for (const t of ["before_start", "starts", "ends"] as const) {
        expect(computeExecutions(wf(t, 60), [step("s1")], meeting, [invitee], t, { now: NOW, backfill: true })).toHaveLength(1);
      }
    });

    it("drops run times in the past instead of storing skipped rows", () => {
      const inTwoHours: EngineMeeting = { ...meeting, startAt: at(120), endAt: at(150) };
      expect(computeExecutions(wf("before_start", 1440), [step("s1")], inTwoHours, [invitee], "before_start", { now: NOW, backfill: true })).toEqual([]);
      const [e] = computeExecutions(wf("before_start", 1440), [step("s1")], meeting, [invitee], "before_start", { now: NOW, backfill: true });
      expect(e).toMatchObject({ status: "scheduled", runAt: at(2 * 1440) });
    });
  });

  it("builds keys and snapshots from the workflow and step", () => {
    expect(executionIdempotencyKey("s1", null, "ev-9", "ends")).toBe("s1:slot:ev-9:ends");
    expect(stepSnapshot(wf("ends", 15, { name: "Thanks", isBasic: true }), step("s1")).isBasic).toBe(true);
  });
});
