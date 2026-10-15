// "Schedule Event" sends one request at a time (docs/QA_REPORT.md, "Found outside these paths" item 8;
// createSubmitGuard in src/components/booking/lib/form.ts, used by booking-flow.tsx): a second click or a fast double
// tap while the first request is in flight sends nothing, a successful booking keeps the form locked while the page
// navigates to the confirmation (no "You've already booked this time." flash), and a real error (slot taken, network,
// validation) leaves a working retry.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSubmitGuard, interpretBookingResponse, type SubmitGuard, type SubmitOutcome } from "@/components/booking/lib/form";

const OK = { ok: true, inviteeId: "inv-1", scheduledEventId: "ev-1" };
const ALREADY_BOOKED = { error: "already_booked", message: "You've already booked this time." };

/**
 * The submit path of booking-flow.tsx reduced to what the guard decides: start() synchronously, await the request,
 * finish(outcome), and apply the outcome only when finish() allows it.
 */
function harness(answers: { status: number; body: unknown }[]) {
  const guard = createSubmitGuard();
  const sent: number[] = [];
  const applied: SubmitOutcome[] = [];
  let release: (() => void)[] = [];
  const submit = async () => {
    if (guard.state !== "idle") return;
    if (!guard.start()) return;
    const n = sent.push(sent.length + 1) - 1;
    await new Promise<void>((resolve) => release.push(resolve));
    const a = answers[Math.min(n, answers.length - 1)]!;
    const outcome = interpretBookingResponse(a.status, a.body);
    if (!guard.finish(outcome)) return;
    applied.push(outcome);
  };
  const respond = async () => {
    const pending = release;
    release = [];
    for (const r of pending) r();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { guard, sent, applied, submit, respond };
}

describe("submit guard", () => {
  it("sends a single request for a double click or a fast double tap in the same tick", async () => {
    const h = harness([{ status: 201, body: OK }, { status: 409, body: ALREADY_BOOKED }]);
    const first = h.submit();
    const second = h.submit();
    const third = h.submit();
    expect(h.sent).toHaveLength(1);
    await h.respond();
    await Promise.all([first, second, third]);
    expect(h.applied).toEqual([{ type: "ok", inviteeId: "inv-1", scheduledEventId: "ev-1", redirectUrl: null }]);
  });

  it("stays locked after a booking, so the navigation to the confirmation never shows an error", async () => {
    const h = harness([{ status: 201, body: OK }, { status: 409, body: ALREADY_BOOKED }]);
    const first = h.submit();
    await h.respond();
    await first;
    expect(h.guard.state).toBe("booked");
    // Clicks during the navigation send nothing and nothing changes on the page.
    await h.submit();
    expect(h.sent).toHaveLength(1);
    expect(h.applied.map((o) => o.type)).toEqual(["ok"]);
    // A stray late answer is ignored too.
    expect(h.guard.finish(interpretBookingResponse(409, ALREADY_BOOKED))).toBe(false);
    expect(h.guard.start()).toBe(false);
  });

  it.each([
    ["slot taken", { status: 409, body: { error: "slot_unavailable", message: "That time is no longer available." } }, "slot_taken"],
    ["validation", { status: 400, body: { error: "validation", fieldErrors: { email: ["Enter a valid email address."] } } }, "fields"],
    ["server error", { status: 500, body: null }, "error"],
    ["email code step", { status: 202, body: { error: "verification_required", reservationId: "res-1" } }, "verify"],
  ] as const)("releases after %s so a retry is sent", async (_label, answer, type) => {
    const h = harness([answer, { status: 201, body: OK }]);
    const first = h.submit();
    await h.respond();
    await first;
    expect(h.applied.map((o) => o.type)).toEqual([type]);
    expect(h.guard.state).toBe("idle");
    const retry = h.submit();
    expect(h.sent).toHaveLength(2);
    await h.respond();
    await retry;
    expect(h.applied.map((o) => o.type)).toEqual([type, "ok"]);
  });

  it("releases after a network failure, and a new submit of an existing booking still shows already_booked", async () => {
    const guard: SubmitGuard = createSubmitGuard();
    expect(guard.start()).toBe(true);
    expect(guard.finish({ type: "error", message: "We couldn't reach the server. Check your connection and try again." })).toBe(true);
    expect(guard.start()).toBe(true);
    const outcome = interpretBookingResponse(409, ALREADY_BOOKED);
    expect(outcome).toEqual({ type: "error", message: "You've already booked this time." });
    expect(guard.finish(outcome)).toBe(true); // a genuinely new submit shows the message
    expect(guard.state).toBe("idle");
  });

  it("release() frees a request that was never sent (bot check failed), and only that", () => {
    const guard = createSubmitGuard();
    guard.release();
    expect(guard.state).toBe("idle");
    expect(guard.start()).toBe(true);
    guard.release();
    expect(guard.start()).toBe(true);
    guard.finish({ type: "ok", inviteeId: "i", scheduledEventId: null, redirectUrl: null });
    guard.release();
    expect(guard.state).toBe("booked");
  });

  it("is what booking-flow.tsx uses: start() before the request, finish() before the outcome is applied", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../src/components/booking/booking-flow.tsx"), "utf8");
    const start = src.indexOf("submitGuard.start()");
    const post = src.indexOf('fetch("/api/public/bookings"');
    const finish = src.indexOf("if (!submitGuard.finish(outcome)) return;");
    const apply = src.indexOf("handleOutcome(outcome, v);");
    expect(src).toContain("useState(createSubmitGuard)");
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(post);
    expect(post).toBeLessThan(finish);
    expect(finish).toBeLessThan(apply);
    // Nothing is awaited between the click and start(): a second click cannot slip in before the guard is taken.
    const submitStart = src.indexOf("const submit = async (viaPointer: boolean) => {");
    expect(submitStart).toBeGreaterThan(0);
    expect(src.slice(submitStart, start)).not.toMatch(/\bawait\b/);
  });
});
