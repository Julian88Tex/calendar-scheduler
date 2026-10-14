// Wizard details and settings (SPEC MP-03, MP-04, MP-27), the results activity feed (MP-16) and the display helpers
// (MP-07, MP-26): Calendly's defaults, the service payload, the edit patch that sends only what changed (a deadline
// kept at its instant across a zone change, co-host order ignored), and the activity and count wording.
import { describe, expect, it } from "vitest";
import { activityText, liveToast } from "@/components/polls/lib/activity";
import { durationLabel, hostNamesLabel, relativeTime, responsesLabel, votesLabel } from "@/components/polls/lib/format";
import { DEFAULT_SETTINGS, deadlineIso, emptyDetails, reminderOffsets, reminderRows, settingsFromView, settingsPayload, updatePatch } from "@/components/polls/lib/settings";
import { interpolate, pt, ptCount } from "@/components/polls/lib/t";
import type { PollActivityView, PollSettingsView } from "@/lib/polls/types";

const NY = "America/New_York";
const BERLIN = "Europe/Berlin";

function view(over: Partial<PollSettingsView> = {}): PollSettingsView {
  return {
    allowIfNeedBe: false,
    hideInvitees: false,
    requireEmail: true,
    verifyEmail: false,
    allowComments: false,
    maxVotesPerOption: null,
    maxChoicesPerParticipant: null,
    deadline: null,
    reserveTimes: false,
    notifyMode: "instant",
    reminderMode: "smart",
    reminderOffsets: [],
    autoBook: false,
    countHostPreference: false,
    hostPreferences: {},
    resultsVisibility: "host_only",
    timeZoneMode: "auto",
    timezone: NY,
    locale: "en",
    sendMeetingReminders: true,
    ...over,
  };
}

const initial = (settings: PollSettingsView = view()) => ({
  title: "Roadmap sync",
  descriptionHtml: null,
  location: null,
  timezone: settings.timezone,
  defaultDurationMinutes: 30,
  settings,
  cohostIds: ["b", "a"],
});

describe("defaults and payload", () => {
  it("starts with Calendly's MP-04 defaults", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      resultsVisibility: "host_only",
      reserveTimes: false,
      allowIfNeedBe: false,
      hideInvitees: false,
      requireEmail: true,
      verifyEmail: false,
      allowComments: false,
      timeZoneMode: "auto",
      notifyMode: "instant",
      reminderMode: "smart",
      autoBook: false,
    });
    const a = emptyDetails();
    a.settings.reminders.push({ kind: "before_deadline", amount: 2, unit: "hours" });
    expect(emptyDetails().settings.reminders).toHaveLength(1);
  });

  it("builds the service fields: verify implies require email, limits only when on, custom reminders only", () => {
    const s = { ...DEFAULT_SETTINGS, verifyEmail: true, requireEmail: false, maxVotes: { enabled: true, value: 3.7 }, reminderMode: "custom" as const, reminders: [{ kind: "before_deadline" as const, amount: 2, unit: "hours" as const }] };
    expect(settingsPayload(s, NY)).toMatchObject({ requireEmail: true, verifyEmail: true, maxVotesPerOption: 3, maxChoicesPerParticipant: null, reminderOffsets: [{ kind: "before_deadline", minutes: 120 }], deadline: null });
    expect(settingsPayload(DEFAULT_SETTINGS, NY).reminderOffsets).toEqual([]);
  });

  it("turns the deadline date and time into an instant of the poll zone", () => {
    const s = { ...DEFAULT_SETTINGS, deadline: { enabled: true, date: "2026-10-23", minutes: 17 * 60 } };
    expect(deadlineIso(s, NY)).toBe("2026-10-23T21:00:00.000Z");
    expect(deadlineIso({ ...s, deadline: { enabled: true, date: null, minutes: 17 * 60 } }, NY)).toBe("invalid");
    expect(deadlineIso(DEFAULT_SETTINGS, NY)).toBeNull();
  });

  it("round trips reminder rows in days or hours", () => {
    const rows = reminderRows([
      { kind: "before_deadline", minutes: 2880 },
      { kind: "after_invite", minutes: 180 },
    ]);
    expect(rows).toEqual([
      { kind: "before_deadline", amount: 2, unit: "days" },
      { kind: "after_invite", amount: 3, unit: "hours" },
    ]);
    expect(reminderOffsets([...rows, { kind: "after_invite", amount: 0, unit: "hours" }])).toEqual([
      { kind: "before_deadline", minutes: 2880 },
      { kind: "after_invite", minutes: 180 },
    ]);
  });
});

describe("updatePatch", () => {
  const details = (settings = settingsFromView(view())) => ({ title: "Roadmap sync", descriptionHtml: "", location: null, settings });

  it("is empty when nothing changed, including co-hosts in another order", () => {
    expect(updatePatch(initial(), { details: details(), timezone: NY, defaultDurationMinutes: 30, cohostIds: ["a", "b"] })).toEqual({});
  });

  it("sends only the changed fields", () => {
    const s = { ...settingsFromView(view()), allowIfNeedBe: true };
    const patch = updatePatch(initial(), { details: { ...details(s), title: "  Roadmap review " }, timezone: NY, defaultDurationMinutes: 45, cohostIds: ["a"] });
    expect(patch).toEqual({ title: "Roadmap review", allowIfNeedBe: true, defaultDurationMinutes: 45, coHostIds: ["a"] });
  });

  it("sends the deadline only when its shown wall time changes meaning, and sends a removal", () => {
    const withDeadline = view({ deadline: "2026-10-23T21:00:00.000Z" });
    const s = settingsFromView(withDeadline);
    expect(s.deadline).toEqual({ enabled: true, date: "2026-10-23", minutes: 17 * 60 });
    expect(updatePatch(initial(withDeadline), { details: details(s), timezone: NY, defaultDurationMinutes: 30, cohostIds: ["a", "b"] })).toEqual({});
    // The host switches the poll to Berlin: the form now reads "Oct 23, 5:00pm" in Berlin, and that is what is saved.
    const moved = updatePatch(initial(withDeadline), { details: details(s), timezone: BERLIN, defaultDurationMinutes: 30, cohostIds: ["a", "b"] });
    expect(moved).toEqual({ timezone: BERLIN, deadline: "2026-10-23T15:00:00.000Z" });
    const removed = updatePatch(initial(withDeadline), { details: details({ ...s, deadline: { ...s.deadline, enabled: false } }), timezone: NY, defaultDurationMinutes: 30, cohostIds: ["a", "b"] });
    expect(removed).toEqual({ deadline: null });
  });
});

describe("activity and labels", () => {
  const act = (type: string, over: Partial<PollActivityView> = {}): PollActivityView => ({ id: "x", type, participantName: "Priya Raman", actorName: null, data: {}, createdAt: "2026-10-14T10:00:00Z", ...over });

  it("words each activity type", () => {
    expect(activityText(act("created", { actorName: "Julian Joseph" }))).toBe("Julian Joseph created the poll");
    expect(activityText(act("voted"))).toBe("Priya Raman voted");
    expect(activityText(act("options_added", { data: { count: 1 } }))).toBe("1 time added");
    expect(activityText(act("options_added", { data: { count: 3 } }))).toBe("3 times added");
    expect(activityText(act("voting_closed", { data: { reason: "deadline" } }))).toBe("Voting closed at the deadline");
    expect(activityText(act("booked", { data: { auto: true } }))).toBe("Booked automatically because everyone agreed");
    expect(activityText(act("voted", { participantName: null }))).toBe("Someone voted");
    expect(activityText(act("something_new"))).toBe("Poll details updated");
  });

  it("toasts voter activity only", () => {
    expect(liveToast(act("voted"))).toBe("Priya Raman voted");
    expect(liveToast(act("commented", { actorName: "Julian Joseph" }))).toBeNull();
    expect(liveToast(act("booked"))).toBeNull();
  });

  it("formats counts, durations, hosts and relative times", () => {
    expect([votesLabel(0), votesLabel(1), votesLabel(2)]).toEqual(["0 Votes", "1 Vote", "2 Votes"]);
    expect(responsesLabel(0, 0)).toBe("No responses yet");
    expect(responsesLabel(1, 0)).toBe("1 response");
    expect(responsesLabel(3, 2, "results")).toBe("3 of 3 responded");
    expect([durationLabel(30), durationLabel(1440), durationLabel(null), durationLabel(null, { mixed: "mixed" })]).toEqual(["30 min", "All day", "Varies", "Mixed durations"]);
    expect([hostNamesLabel(["Ana"]), hostNamesLabel(["Ana", "Ben"]), hostNamesLabel(["Ana", "Ben", "Cy"])]).toEqual(["Ana", "Ana and Ben", "Ana and 2 others"]);
    const now = Date.parse("2026-10-14T10:00:00Z");
    expect(relativeTime(now - 10_000, now)).toBe("just now");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3 hours ago");
    expect(relativeTime(now + 86_400_000, now)).toBe("tomorrow");
  });

  it("interpolates copy and falls back to the key", () => {
    expect(interpolate("{a} and {b}", { a: 1 })).toBe("1 and {b}");
    expect(pt("no.such.key")).toBe("no.such.key");
    expect(ptCount(1, "common.timeCount", "common.timesCount")).toBe("1 time");
  });
});
