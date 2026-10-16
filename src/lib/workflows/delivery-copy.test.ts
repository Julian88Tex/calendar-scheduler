// The "Reminders may be sent late" warning copy (SPEC GEN-16, NT-23): what is wrong and what to do, per dispatcher.
import { describe, expect, it } from "vitest";
import { deliveryProblem, deliveryRemedy, lastRunLabel } from "./delivery-copy";

const NOW = Date.parse("2030-10-08T18:00:00Z");

describe("delivery warning copy", () => {
  it("names overdue reminders first, otherwise when jobs last ran", () => {
    expect(deliveryProblem({ overdueCount: 1, lastCronAt: null, nowMs: NOW })).toBe("1 reminder is past its send time and has not gone out yet.");
    expect(deliveryProblem({ overdueCount: 3, lastCronAt: null, nowMs: NOW })).toBe("3 reminders are past their send time and have not gone out yet.");
    expect(deliveryProblem({ overdueCount: 0, lastCronAt: null, nowMs: NOW })).toBe("Scheduled jobs last ran: Never.");
    expect(deliveryProblem({ overdueCount: 0, lastCronAt: new Date(NOW - 20 * 60_000).toISOString(), nowMs: NOW })).toBe(
      "Scheduled jobs last ran: 20 minutes ago.",
    );
  });

  it("tells cron deployments to add a pinger, with the CRON_SECRET header when one is set", () => {
    expect(deliveryRemedy({ dispatcher: "cron", cronSecretConfigured: false })).toBe(
      "Reminders go out when /api/cron runs. To send them on time, set up a pinger (for example cron-job.org) that calls this URL every 5 minutes.",
    );
    expect(deliveryRemedy({ dispatcher: "cron", cronSecretConfigured: true })).toContain(
      "every 5 minutes, with the header Authorization: Bearer followed by your CRON_SECRET.",
    );
  });

  it("tells self-hosted servers that their job runner is not keeping up (not that cron is missing)", () => {
    const text = deliveryRemedy({ dispatcher: "poller", cronSecretConfigured: false });
    expect(text).toContain("background job runner");
    expect(text).not.toContain("Reminders go out when /api/cron runs");
  });

  it("labels the last run like the dashboard banner", () => {
    expect(lastRunLabel(null, NOW)).toBe("Never");
    expect(lastRunLabel(new Date(NOW - 30_000).toISOString(), NOW)).toBe("Less than a minute ago");
    expect(lastRunLabel(new Date(NOW - 60_000).toISOString(), NOW)).toBe("1 minute ago");
    expect(lastRunLabel(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe("3 hours ago");
    expect(lastRunLabel(new Date(NOW - 72 * 3_600_000).toISOString(), NOW)).toBe("3 days ago");
  });
});
