// Page state of the invitee cancel and reschedule pages (SPEC CR-02, CR-03, CR-08, SCH-23): chain redirects, refusal
// copy for each change rule, the guests notice, paths and query strings. Pure (src/components/lifecycle/lib/state.ts).
import { describe, expect, it } from "vitest";
import { blockedCopy, changePagePath, changePageState, guestsNotice, queryStringOf, type ChangeDecision } from "@/components/lifecycle/lib/state";
import messages from "@/lib/i18n/messages/en/lifecycle";
import type { ChangeBlock } from "@/lib/lifecycle/policy";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const canceled: ChangeBlock = { reason: "canceled", message: messages.changes.canceled };
const occurred: ChangeBlock = { reason: "occurred", message: messages.changes.occurred };
const notReschedulable: ChangeBlock = { reason: "not_reschedulable", message: messages.changes.notReschedulable };
const cutoff: ChangeBlock = {
  reason: "cutoff",
  message: messages.changes.cutoff.replace("{hostName}", "Julian Joseph"),
  hostName: "Julian Joseph",
  hostEmail: "owner@example.com",
};

const decision = (over: Partial<ChangeDecision> = {}): ChangeDecision => ({
  requestedInviteeId: A,
  inviteeId: A,
  moved: false,
  cancelBlock: null,
  rescheduleBlock: null,
  ...over,
});

describe("changePageState", () => {
  it("redirects an old invitee of a reschedule chain to the active invitee (CR-02)", () => {
    expect(changePageState("cancel", decision({ inviteeId: B, moved: true }), "Julian")).toEqual({ state: "redirect", inviteeId: B });
    expect(changePageState("reschedule", decision({ inviteeId: B, moved: true, rescheduleBlock: notReschedulable }), "Julian")).toEqual({
      state: "redirect",
      inviteeId: B,
    });
  });

  it("shows the form when the change is allowed", () => {
    expect(changePageState("cancel", decision(), "Julian")).toEqual({ state: "form" });
    expect(changePageState("reschedule", decision(), "Julian")).toEqual({ state: "form" });
  });

  it("cancel page: already canceled, already occurred and the SCH-23 cutoff with the host's email", () => {
    const c = changePageState("cancel", decision({ cancelBlock: canceled, rescheduleBlock: notReschedulable }), "Julian");
    expect(c).toEqual({ state: "blocked", copy: { reason: "canceled", title: "This event has already been canceled.", body: null, contact: null, cancelAvailable: false } });
    const o = changePageState("cancel", decision({ cancelBlock: occurred }), "Julian");
    expect(o.state === "blocked" && o.copy.title).toBe("This event has already occurred.");
    const k = changePageState("cancel", decision({ cancelBlock: cutoff, rescheduleBlock: cutoff }), "Julian Joseph");
    expect(k).toEqual({
      state: "blocked",
      copy: {
        reason: "cutoff",
        title: "This meeting can no longer be changed online. Please contact Julian Joseph.",
        body: null,
        contact: { name: "Julian Joseph", email: "owner@example.com" },
        cancelAvailable: false,
      },
    });
  });

  it("cancel still works when only rescheduling is refused (event type off, one-off, poll)", () => {
    expect(changePageState("cancel", decision({ rescheduleBlock: notReschedulable }), "Julian")).toEqual({ state: "form" });
    const r = changePageState("reschedule", decision({ rescheduleBlock: notReschedulable }), "Julian Joseph");
    expect(r).toEqual({
      state: "blocked",
      copy: {
        reason: "not_reschedulable",
        title: "This event can no longer be rescheduled.",
        body: "Please contact Julian Joseph if you need to change this meeting.",
        contact: null,
        cancelAvailable: true,
      },
    });
  });

  it("reschedule page: canceled and past meetings say why, without a cancel link", () => {
    const c = blockedCopy("reschedule", { cancelBlock: canceled, rescheduleBlock: notReschedulable }, "Julian");
    expect(c).toMatchObject({ title: "This event can no longer be rescheduled.", body: "This event has already been canceled.", cancelAvailable: false });
    const o = blockedCopy("reschedule", { cancelBlock: occurred, rescheduleBlock: notReschedulable }, "Julian");
    expect(o).toMatchObject({ body: "This event has already occurred.", cancelAvailable: false });
    const rescheduled = blockedCopy("reschedule", { cancelBlock: { reason: "rescheduled", message: messages.changes.rescheduled }, rescheduleBlock: notReschedulable }, "Julian");
    expect(rescheduled?.body).toBe("This event has already been canceled.");
  });

  it("reschedule page inside the cutoff: the SCH-23 message with the host's email", () => {
    const k = blockedCopy("reschedule", { cancelBlock: cutoff, rescheduleBlock: cutoff }, "Julian Joseph");
    expect(k).toEqual({ reason: "cutoff", title: cutoff.message, body: null, contact: { name: "Julian Joseph", email: "owner@example.com" }, cancelAvailable: false });
    // An event type that is off inside the cutoff: not reschedulable, and canceling is blocked by the cutoff.
    const off = blockedCopy("reschedule", { cancelBlock: cutoff, rescheduleBlock: notReschedulable }, "Julian Joseph");
    expect(off).toEqual({ reason: "not_reschedulable", title: messages.changes.notReschedulable, body: cutoff.message, contact: { name: "Julian Joseph", email: "owner@example.com" }, cancelAvailable: false });
  });

  it("a rebook after 'Share new times to meet' opens the flow although the meeting is canceled (CR-08)", () => {
    expect(changePageState("reschedule", decision({ cancelBlock: canceled, rescheduleBlock: null }), "Julian")).toEqual({ state: "form" });
    expect(changePageState("cancel", decision({ cancelBlock: canceled, rescheduleBlock: null }), "Julian").state).toBe("blocked");
  });
});

describe("guestsNotice", () => {
  it("names the invitee and counts the guests (CR-02)", () => {
    expect(guestsNotice("Ana Lima", 0)).toBeNull();
    expect(guestsNotice("Ana Lima", 1)).toBe("This event will be canceled for Ana Lima and 1 guest.");
    expect(guestsNotice("Ana Lima", 3)).toBe("This event will be canceled for Ana Lima and 3 guests.");
  });
});

describe("paths", () => {
  it("builds the capability paths with an optional query", () => {
    expect(changePagePath("cancel", A)).toBe(`/cancellations/${A}`);
    expect(changePagePath("reschedule", A, "month=2030-10")).toBe(`/reschedulings/${A}?month=2030-10`);
    expect(changePagePath("reschedule", A, "?a=1")).toBe(`/reschedulings/${A}?a=1`);
    expect(queryStringOf({ month: "2030-10", date: "2030-10-08", x: ["1", "2"], y: undefined })).toBe("month=2030-10&date=2030-10-08");
  });
});
