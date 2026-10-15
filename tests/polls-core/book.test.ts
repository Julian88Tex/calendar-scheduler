// Booking the final time on PGlite with the real booking-core and lifecycle-core (SPEC MP-18 to MP-21, MP-25): the
// meeting and one invitee per selected person in email confirmation mode, one email per invitee with only their own
// links, shared or individual ICS invites (hide invitees), app conflicts block while external conflicts and buffers
// do not, a double click books once, reopen and rebook moves the same meeting (SEQUENCE + 1), a canceled meeting
// keeps the poll booked, Reserve times blocks the owner's regular event type, and calendar holds with a Google
// destination (fake provider) that never lists invitees.
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ext = vi.hoisted(() => ({ busy: {} as Record<string, { start: Date; end: Date; title: string }[]> }));

vi.mock("@/lib/calendars", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/calendars")>();
  return {
    ...real,
    getExternalBusy: async (p: { userIds: string[] }) =>
      Object.fromEntries(
        p.userIds.map((id) => [
          id,
          { ok: true, stale: false, nocal: false, busy: (ext.busy[id] ?? []).map((b, i) => ({ ...b, allDay: false, calendarId: "cal-1", externalId: `ext-${i}` })) },
        ]),
      ),
  };
});
vi.mock("@/lib/calendars/credentials", () => ({
  withConnection: async (connectionId: string, fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ connectionId, userId: "", provider: "google", accessToken: "fake-access", unavailableStatuses: [] }),
  encryptedTokenColumns: async () => ({}),
}));
vi.mock("@/lib/calendars/providers/registry", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/calendars/providers/registry")>();
  const { fakeCalendarProvider } = await import("../helpers/fake-providers");
  return { ...real, getProvider: (id: "google") => fakeCalendarProvider(id) };
});

const { calendarLinkedEvents, invitees, meetingPollOptions, scheduledEvents, users } = await import("@/db/schema");
const { resetFakeTime, setFakeNow, now } = await import("@/lib/time/now");
const { createBooking } = await import("@/lib/booking/create");
const { getAvailability } = await import("@/lib/booking/availability");
const { loadEventType } = await import("@/lib/booking/target");
const { cancelScheduledEvent } = await import("@/lib/lifecycle");
const { getPollReservedIntervals } = await import("@/lib/polls");
const { bookPoll, bookingPreview } = await import("@/lib/polls/book");
const { deletePoll, reopenPoll } = await import("@/lib/polls/manage");
const { getBookedMeetingIcs, getHostPoll, getVoterView } = await import("@/lib/polls/queries");
const { updatePoll } = await import("@/lib/polls/update");
const { expireIfEnded } = await import("@/lib/polls/job-handlers");
const { fakeCalendarProvider, resetFakeProviders } = await import("../helpers/fake-providers");
const { createBooking: insertMeeting, createCalendarConnection, createEventType } = await import("../factories");
const { useTestDb } = await import("../helpers/db");
const { MIN, NOW, drain, la, newPoll, outbox, pollRow, setupHost, vote } = await import("./helpers");

const t = useTestDb();
beforeEach(() => {
  setFakeNow(NOW);
  resetFakeProviders();
  ext.busy = {};
});
afterEach(() => resetFakeTime());

type Host = Awaited<ReturnType<typeof setupHost>>;

async function optionIds(pollId: string): Promise<string[]> {
  const rows = await t.db.select().from(meetingPollOptions).where(eq(meetingPollOptions.pollId, pollId));
  const key = (o: (typeof rows)[number]) => o.startsAt?.getTime() ?? Date.parse(`${o.allDayDate}T00:00:00Z`);
  return rows.filter((o) => !o.deletedAt).sort((a, b) => key(a) - key(b)).map((o) => o.id);
}

/** A poll with two voters (Ana: Yes on the first time, Bo: Yes on the first two). */
async function votedPoll(host: Host, over: Parameters<typeof newPoll>[1] = {}) {
  const created = await newPoll(host, over);
  const [a, b, c] = await optionIds(created.pollId);
  const ana = await vote(created.slug, { name: "Ana Lima", email: "ana@example.com", votes: [{ optionId: a!, choice: "yes" }] });
  const bo = await vote(created.slug, { name: "Bo Chen", email: "bo@example.com", timezone: "Asia/Kolkata", votes: [{ optionId: a!, choice: "yes" }, { optionId: b!, choice: "yes" }] });
  if (!ana.ok || !bo.ok) throw new Error("votes failed");
  return { ...created, options: [a!, b!, c!], ana, bo };
}

async function bookDefault(host: Host, pollId: string, optionId: string, extra: Partial<Parameters<typeof bookPoll>[1] & object> = {}) {
  const preview = await bookingPreview(host.actor, pollId, optionId);
  const chosen = preview.invitees.filter((i) => i.checked).map((i) => ({ participantId: i.participantId, email: i.email!, name: i.name }));
  return bookPoll(host.actor, { pollId, optionId, invitees: chosen, ...extra });
}

async function inviteesOf(scheduledEventId: string) {
  return t.db.select().from(invitees).where(eq(invitees.scheduledEventId, scheduledEventId));
}

/** ATTENDEE emails of an ICS file. */
function attendees(ics: string | null | undefined): string[] {
  const unfolded = (ics ?? "").replace(/\r?\n[ \t]/g, "");
  return [...unfolded.matchAll(/^ATTENDEE[^:]*:mailto:(.+)$/gim)].map((m) => m[1]!.trim().toLowerCase());
}
const uidOf = (ics: string | null | undefined) => /^UID:(.+)$/m.exec((ics ?? "").replace(/\r?\n[ \t]/g, ""))?.[1]?.trim() ?? null;
const seqOf = (ics: string | null | undefined) => Number(/^SEQUENCE:(\d+)$/m.exec(ics ?? "")?.[1] ?? NaN);

describe("Book meeting (MP-18, MP-19)", () => {
  it("creates the meeting and one invitee per person, one email per invitee with only their own links, all attendees in the shared ICS", async () => {
    const host = await setupHost(t.db);
    const p = await votedPoll(host);
    const preview = await bookingPreview(host.actor, p.pollId, p.options[0]!);
    expect(preview).toMatchObject({ title: "Roadmap sync", blocking: [], warnings: [], hideInvitees: false, rebook: null, otherZones: 2, unbookableReason: null });
    expect(preview.invitees.map((i) => [i.name, i.section, i.checked])).toEqual([
      ["Ana Lima", "can_attend", true],
      ["Bo Chen", "can_attend", true],
    ]);
    const result = await bookDefault(host, p.pollId, p.options[0]!);
    expect(result.mode).toBe("booked");
    const [m] = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, result.scheduledEventId));
    const poll = await pollRow(t.db, p.pollId);
    expect(m).toMatchObject({ source: "poll", pollId: p.pollId, eventTypeId: poll.eventTypeId, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, status: "active" });
    expect(m!.startAt.toISOString()).toBe(la("2030-10-09 10:00").toISOString());
    expect(poll).toMatchObject({ status: "booked", bookedOptionId: p.options[0], bookedScheduledEventId: m!.id, bookedByUserId: host.user.id });
    const list = await inviteesOf(m!.id);
    expect(list.map((i) => [i.email, i.pollParticipantId]).sort()).toEqual(
      [
        ["ana@example.com", p.ana.participantId],
        ["bo@example.com", p.bo.participantId],
      ].sort(),
    );
    expect(list.find((i) => i.email === "bo@example.com")?.timezone).toBe("Asia/Kolkata");

    await drain(t.db, { lifecycle: true });
    const ana = list.find((i) => i.email === "ana@example.com")!;
    const bo = list.find((i) => i.email === "bo@example.com")!;
    for (const [mine, other] of [
      [ana, bo],
      [bo, ana],
    ] as const) {
      const mails = await outbox(t.db, { to: mine.email, template: "lifecycle.invitee_confirmation", scheduledEventId: m!.id });
      expect(mails).toHaveLength(1);
      expect(mails[0]!.html).toContain(`/cancellations/${mine.id}`);
      expect(mails[0]!.html).not.toContain(`/cancellations/${other.id}`);
      expect(uidOf(mails[0]!.ics)).toBe(m!.icsUid);
      expect(attendees(mails[0]!.ics)).toEqual(expect.arrayContaining(["ana@example.com", "bo@example.com"]));
    }
    expect(await outbox(t.db, { to: host.user.email, template: "lifecycle.host_new_event", scheduledEventId: m!.id })).toHaveLength(1);
    // The voter page shows the booked state; booking the same time again answers the same meeting.
    const view = await getVoterView(p.slug, { editToken: p.ana.editToken });
    if (view.status !== 200) throw new Error("view");
    expect(view.view.poll.status).toBe("booked");
    expect(view.view.booked).toMatchObject({ scheduledEventId: m!.id, status: "active" });
    expect(view.view.booked?.addToCalendar.map((l) => l.id)).toEqual(["google", "outlook", "office365", "ical"]);
    expect(await bookDefault(host, p.pollId, p.options[0]!)).toEqual({ scheduledEventId: m!.id, mode: "unchanged" });
    await expect(bookDefault(host, p.pollId, p.options[1]!)).rejects.toMatchObject({ message: "Reopen the poll to choose a different time." });
  });

  it("hide invitees: individual ICS invites listing only that invitee among the non-host attendees (MP-20)", async () => {
    const host = await setupHost(t.db);
    const p = await votedPoll(host, { hideInvitees: true });
    expect((await bookingPreview(host.actor, p.pollId, p.options[0]!)).hideInvitees).toBe(true);
    const { scheduledEventId } = await bookDefault(host, p.pollId, p.options[0]!);
    await drain(t.db, { lifecycle: true });
    for (const inv of await inviteesOf(scheduledEventId)) {
      const mail = (await outbox(t.db, { to: inv.email, template: "lifecycle.invitee_confirmation", scheduledEventId }))[0]!;
      const people = attendees(mail.ics).filter((e) => e !== host.user.email.toLowerCase());
      expect(people).toEqual([inv.email]);
      expect(uidOf(mail.ics)).toBe(`${inv.id}@localhost`);
    }
  });

  it("app meetings block, buffers and external events do not (MP-18 acceptance)", async () => {
    const host = await setupHost(t.db);
    const p = await votedPoll(host);
    const { eventType } = await createEventType(t.db, { owner: host.user, name: "30 Minute Virtual", slug: "30min", durationMinutes: 30, overrides: { bufferAfterMinutes: 15, bufferBeforeMinutes: 15 } });
    // Overlaps the first time: blocks.
    await insertMeeting(t.db, { eventType, start: la("2030-10-09 10:15"), durationMinutes: 30 });
    // Ends right before the second time: only its 15 minute buffer overlaps it.
    await insertMeeting(t.db, { eventType, start: la("2030-10-09 10:30"), durationMinutes: 30 });
    ext.busy[host.user.id] = [{ start: la("2030-10-10 13:30"), end: la("2030-10-10 15:00"), title: "Dentist" }];
    const blocked = await bookingPreview(host.actor, p.pollId, p.options[0]!);
    expect(blocked.blocking).toHaveLength(1);
    expect(blocked.blocking[0]).toMatchObject({ title: "30 Minute Virtual", hostName: "Julian Joseph" });
    await expect(bookDefault(host, p.pollId, p.options[0]!)).rejects.toMatchObject({ code: "slot_unavailable", message: "You already have '30 Minute Virtual' at this time." });
    const results = await getHostPoll(host.actor, p.pollId);
    expect(results.options.find((o) => o.id === p.options[0])?.hostStatus).toMatchObject({ state: "booked", title: "30 Minute Virtual" });
    expect(results.options.find((o) => o.id === p.options[1])?.hostStatus).toEqual({ state: "free" });
    expect(results.options.find((o) => o.id === p.options[2])?.hostStatus).toMatchObject({ state: "conflict", title: "Dentist" });

    const external = await bookingPreview(host.actor, p.pollId, p.options[2]!);
    expect(external.blocking).toEqual([]);
    expect(external.warnings).toEqual([{ kind: "calendar", title: "Dentist", hostName: "Julian Joseph" }]);
    const overBuffer = await bookPoll(host.actor, { pollId: p.pollId, optionId: p.options[1]!, invitees: [{ participantId: p.bo.participantId, email: "bo@example.com" }] });
    expect(overBuffer.mode).toBe("booked");
  });

  it("an external conflict only warns: booking succeeds", async () => {
    const host = await setupHost(t.db);
    const p = await votedPoll(host);
    ext.busy[host.user.id] = [{ start: la("2030-10-09 09:00"), end: la("2030-10-09 12:00"), title: "Offsite" }];
    const r = await bookDefault(host, p.pollId, p.options[0]!);
    expect(r.mode).toBe("booked");
  });

  it("refuses past times and empty invitee lists; all-day times can be booked (long ones: long-options.test.ts)", async () => {
    const host = await setupHost(t.db);
    const p = await votedPoll(host, {
      options: [
        { start: la("2030-10-09 10:00").toISOString(), end: la("2030-10-09 10:30").toISOString() },
        { start: la("2030-10-09 11:00").toISOString(), end: la("2030-10-09 11:30").toISOString() },
        { date: "2030-10-12" },
      ],
    });
    await expect(bookPoll(host.actor, { pollId: p.pollId, optionId: p.options[0]!, invitees: [] })).rejects.toBeDefined();
    const allDay = (await t.db.select().from(meetingPollOptions).where(eq(meetingPollOptions.pollId, p.pollId))).find((o) => o.allDayDate)!;
    expect((await bookingPreview(host.actor, p.pollId, allDay.id)).unbookableReason).toBeNull();
    setFakeNow(new Date(la("2030-10-09 10:05").getTime()));
    await expect(bookPoll(host.actor, { pollId: p.pollId, optionId: p.options[0]!, invitees: [{ email: "x@example.com" }] })).rejects.toMatchObject({ message: "That time has already passed." });
  });

  it("co-hosts can book; the meeting has every host (collective)", async () => {
    const host = await setupHost(t.db);
    const co = await setupHost(t.db, { name: "Kim Co", organizationId: host.user.organizationId, orgRole: "user" });
    const p = await votedPoll(host, { coHostIds: [co.user.id] });
    const r = await bookDefault(co, p.pollId, p.options[0]!);
    const m = (await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, r.scheduledEventId)))[0]!;
    expect(m.organizerUserId).toBe(host.user.id);
    const { scheduledEventHosts } = await import("@/db/schema");
    const hosts = await t.db.select().from(scheduledEventHosts).where(eq(scheduledEventHosts.scheduledEventId, m.id));
    expect(hosts.map((h) => h.userId).sort()).toEqual([host.user.id, co.user.id].sort());
    expect((await pollRow(t.db, p.pollId)).bookedByUserId).toBe(co.user.id);
  });
});

describe("Book dialog options (MP-18, MP-19)", () => {
  it("'Send meeting reminders' emails the invitees 24 hours and 1 hour before; 'The time has been chosen' reaches people left out", async () => {
    const host = await setupHost(t.db);
    const p = await votedPoll(host);
    const cara = await vote(p.slug, { name: "Cara", email: "cara@example.com" });
    expect(cara.ok).toBe(true);
    const r = await bookPoll(host.actor, {
      pollId: p.pollId,
      optionId: p.options[0]!,
      invitees: [{ participantId: p.ana.participantId, email: "ana@example.com" }],
      message: "Bring the Q4 numbers",
      sendMeetingReminders: true,
      notifyExcluded: true,
    });
    await drain(t.db, { lifecycle: true });
    const [inv] = await inviteesOf(r.scheduledEventId);
    expect(inv!.questionsAndAnswers).toEqual([expect.objectContaining({ question: "Message from Julian Joseph", answer: "Bring the Q4 numbers" })]);
    const chosen = await outbox(t.db, { template: "polls.time_chosen", pollId: p.pollId });
    expect(chosen.map((m) => m.toAddresses[0]).sort()).toEqual(["bo@example.com", "cara@example.com"]);
    expect(chosen[0]!.subject).toBe("A time was chosen for Roadmap sync");
    setFakeNow(new Date(la("2030-10-08 10:01").getTime()));
    await drain(t.db, { lifecycle: true });
    setFakeNow(new Date(la("2030-10-09 09:01").getTime()));
    await drain(t.db, { lifecycle: true });
    const reminders = await outbox(t.db, { to: "ana@example.com", template: "polls.meeting_reminder" });
    expect(reminders).toHaveLength(2);
  });
});

describe("reopen, rebook, cancel (MP-21)", () => {
  it("rebooking another time moves the same meeting in place with SEQUENCE + 1 and reconciles invitees", async () => {
    const host = await setupHost(t.db);
    const p = await votedPoll(host);
    const first = await bookDefault(host, p.pollId, p.options[0]!);
    await drain(t.db, { lifecycle: true });
    const before = (await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, first.scheduledEventId)))[0]!;
    await reopenPoll(host.actor, { pollId: p.pollId });
    expect((await pollRow(t.db, p.pollId)).status).toBe("open");
    const preview = await bookingPreview(host.actor, p.pollId, p.options[1]!);
    expect(preview.rebook).toMatchObject({ scheduledEventId: first.scheduledEventId, sameOption: false });
    // Only Bo can make the second time: Ana is removed (CANCEL), Bo stays, Cara (added by hand) is invited.
    const second = await bookPoll(host.actor, {
      pollId: p.pollId,
      optionId: p.options[1]!,
      invitees: [{ participantId: p.bo.participantId, email: "bo@example.com" }, { email: "cara@example.com", name: "Cara" }],
    });
    expect(second).toEqual({ scheduledEventId: first.scheduledEventId, mode: "rebooked" });
    await drain(t.db, { lifecycle: true });
    const after = (await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, first.scheduledEventId)))[0]!;
    expect(after.startAt.toISOString()).toBe(la("2030-10-09 11:00").toISOString());
    expect(after.icsUid).toBe(before.icsUid);
    expect(after.icsSequence).toBeGreaterThan(before.icsSequence);
    expect(await pollRow(t.db, p.pollId)).toMatchObject({ status: "booked", bookedOptionId: p.options[1], bookedScheduledEventId: first.scheduledEventId });
    const list = await inviteesOf(first.scheduledEventId);
    expect(list.filter((i) => i.status === "active").map((i) => i.email).sort()).toEqual(["bo@example.com", "cara@example.com"]);
    expect(list.find((i) => i.email === "ana@example.com")?.status).toBe("canceled");
    const updated = await outbox(t.db, { to: "bo@example.com", template: "lifecycle.invitee_rescheduled", scheduledEventId: first.scheduledEventId });
    expect(updated).toHaveLength(1);
    expect(uidOf(updated[0]!.ics)).toBe(before.icsUid);
    expect(seqOf(updated[0]!.ics)).toBe(after.icsSequence);
    expect(await outbox(t.db, { to: "ana@example.com", template: "lifecycle.invitee_canceled", scheduledEventId: first.scheduledEventId })).toHaveLength(1);
    expect(await outbox(t.db, { to: "cara@example.com", template: "lifecycle.invitee_confirmation", scheduledEventId: first.scheduledEventId })).toHaveLength(1);
  });

  it("rebooking the same time for entirely new people cancels the old meeting and books a new one for them", async () => {
    const host = await setupHost(t.db);
    const p = await votedPoll(host);
    const first = await bookDefault(host, p.pollId, p.options[0]!);
    await drain(t.db, { lifecycle: true });
    await reopenPoll(host.actor, { pollId: p.pollId, notify: false });
    // Ana and Bo are both left out, Cara is added by hand: nobody of the old meeting stays.
    const again = await bookPoll(host.actor, { pollId: p.pollId, optionId: p.options[0]!, invitees: [{ email: "cara@example.com", name: "Cara" }] });
    expect(again.mode).toBe("rebooked");
    expect(again.scheduledEventId).not.toBe(first.scheduledEventId);
    await drain(t.db, { lifecycle: true });
    expect((await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, first.scheduledEventId)))[0]?.status).toBe("canceled");
    const fresh = (await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, again.scheduledEventId)))[0]!;
    expect(fresh).toMatchObject({ status: "active", pollId: p.pollId });
    expect(fresh.startAt.toISOString()).toBe(la("2030-10-09 10:00").toISOString());
    expect((await inviteesOf(again.scheduledEventId)).filter((i) => i.status === "active").map((i) => i.email)).toEqual(["cara@example.com"]);
    expect(await pollRow(t.db, p.pollId)).toMatchObject({ status: "booked", bookedOptionId: p.options[0], bookedScheduledEventId: again.scheduledEventId });
    expect(await outbox(t.db, { to: "cara@example.com", template: "lifecycle.invitee_confirmation", scheduledEventId: again.scheduledEventId })).toHaveLength(1);
    expect(await outbox(t.db, { to: "ana@example.com", template: "lifecycle.invitee_canceled", scheduledEventId: first.scheduledEventId })).toHaveLength(1);
  });

  it("a meeting canceled from Meetings leaves the poll booked with 'Meeting canceled', then Reopen poll and book again", async () => {
    const host = await setupHost(t.db);
    const p = await votedPoll(host);
    const first = await bookDefault(host, p.pollId, p.options[0]!);
    await cancelScheduledEvent({ scheduledEventId: first.scheduledEventId, actor: { type: "user", ctx: host.actor }, reason: "Something came up", notify: true });
    await drain(t.db, { lifecycle: true });
    const results = await getHostPoll(host.actor, p.pollId);
    expect(results.poll.status).toBe("booked");
    expect(results.booked?.status).toBe("canceled");
    expect(results.activity.find((a) => a.data.kind === "meeting_canceled")).toBeDefined();
    await expect(bookDefault(host, p.pollId, p.options[0]!)).rejects.toMatchObject({ message: "Reopen the poll to choose a different time." });
    await reopenPoll(host.actor, { pollId: p.pollId, notify: false });
    const again = await bookDefault(host, p.pollId, p.options[1]!);
    expect(again.mode).toBe("booked");
    expect(again.scheduledEventId).not.toBe(first.scheduledEventId);
  });
});

describe("the booked voter page (MP-15, GEN-08)", () => {
  it("shows the join link, location and calendar links to invitees and hosts only, never to others holding the link", async () => {
    const host = await setupHost(t.db);
    const p = await votedPoll(host);
    // Ana is the only invitee; Bo voted but was left out.
    const r = await bookPoll(host.actor, { pollId: p.pollId, optionId: p.options[0]!, invitees: [{ participantId: p.ana.participantId, email: "ana@example.com" }] });
    await drain(t.db, { lifecycle: true });
    await t.db
      .update(scheduledEvents)
      .set({ location: { configId: null, kind: "google_conference", location: "https://meet.google.com/abc-defg-hij", additionalInfo: null, joinUrl: "https://meet.google.com/abc-defg-hij", status: "pushed", providerMeetingId: null, password: null, dialIn: null, data: null, error: null } })
      .where(eq(scheduledEvents.id, r.scheduledEventId));

    const anonymous = await getVoterView(p.slug, {});
    const bo = await getVoterView(p.slug, { editToken: p.bo.editToken });
    for (const v of [anonymous, bo]) {
      if (v.status !== 200) throw new Error("view");
      expect(v.view.booked).toMatchObject({ status: "active", scheduledEventId: null, joinUrl: null, locationText: null, addToCalendar: [] });
      expect(JSON.stringify(v.view)).not.toContain("meet.google.com");
      expect(JSON.stringify(v.view)).not.toContain(r.scheduledEventId);
    }
    const ana = await getVoterView(p.slug, { editToken: p.ana.editToken });
    if (ana.status !== 200) throw new Error("view");
    expect(ana.view.booked).toMatchObject({ scheduledEventId: r.scheduledEventId, joinUrl: `http://localhost:3000/events/${r.scheduledEventId}/join` });
    expect(ana.view.booked!.addToCalendar.length).toBeGreaterThan(0);
    const hostView = await getVoterView(p.slug, { viewer: { userId: host.user.id, name: host.user.name, email: host.user.email } });
    if (hostView.status !== 200) throw new Error("view");
    expect(hostView.view.booked?.scheduledEventId).toBe(r.scheduledEventId);

    // The "Add to calendar" download carries the join link: invitees and hosts only.
    expect(await getBookedMeetingIcs(p.slug, {})).toBeNull();
    expect(await getBookedMeetingIcs(p.slug, { editToken: p.bo.editToken })).toBeNull();
    expect((await getBookedMeetingIcs(p.slug, { editToken: p.ana.editToken }))?.ics).toContain("BEGIN:VCALENDAR");
    expect(await getBookedMeetingIcs(p.slug, { viewer: { userId: host.user.id, email: host.user.email } })).not.toBeNull();
  });

  it("an in-person address stays visible to everyone (it was on the page before booking)", async () => {
    const host = await setupHost(t.db);
    const p = await votedPoll(host);
    await bookPoll(host.actor, { pollId: p.pollId, optionId: p.options[0]!, invitees: [{ participantId: p.ana.participantId, email: "ana@example.com" }] });
    const anonymous = await getVoterView(p.slug, {});
    if (anonymous.status !== 200) throw new Error("view");
    expect(anonymous.view.booked).toMatchObject({ scheduledEventId: null, locationText: "Blue Bottle, 66 Mint St", addToCalendar: [] });
  });
});

describe("a reopened poll keeps its meeting (MP-21, MP-27)", () => {
  it("title edits reach the kept meeting, its location is locked, and it is booked again once every time passed", async () => {
    const host = await setupHost(t.db);
    const p = await votedPoll(host);
    const first = await bookDefault(host, p.pollId, p.options[0]!);
    await drain(t.db, { lifecycle: true });
    await reopenPoll(host.actor, { pollId: p.pollId, notify: false });
    await updatePoll(host.actor, { pollId: p.pollId, title: "Roadmap sync (final)" });
    expect((await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, first.scheduledEventId)))[0]?.name).toBe("Roadmap sync (final)");
    await expect(updatePoll(host.actor, { pollId: p.pollId, location: { id: "5eed0000-0000-4000-8000-0000000000b2", kind: "physical", position: 0, location: "Elsewhere" } })).rejects.toMatchObject({
      message: "The location of a scheduled meeting can't be changed here.",
    });
    // The unchanged location (keys in another order) is not a change.
    await updatePoll(host.actor, { pollId: p.pollId, location: { location: "Blue Bottle, 66 Mint St", position: 0, kind: "physical", id: "5eed0000-0000-4000-8000-0000000000b1" } });
    // Every time passes without a new booking: the poll is booked again (the meeting stands), not "ended".
    setFakeNow(new Date(la("2030-10-10 14:00").getTime() + MIN));
    expect(await expireIfEnded(t.db, p.pollId, now())).toBe(false);
    expect(await pollRow(t.db, p.pollId)).toMatchObject({ status: "booked", bookedScheduledEventId: first.scheduledEventId });
    expect(await outbox(t.db, { template: "polls.ended" })).toHaveLength(0);
  });
});

describe("deleting a booked poll (MP-22)", () => {
  it("keeps the scheduled meeting by default and cancels it with 'Cancel it too'", async () => {
    const host = await setupHost(t.db);
    const keep = await votedPoll(host, { title: "Keep me" });
    const kept = await bookDefault(host, keep.pollId, keep.options[0]!);
    await deletePoll(host.actor, { pollId: keep.pollId });
    expect((await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, kept.scheduledEventId)))[0]?.status).toBe("active");
    expect((await pollRow(t.db, keep.pollId)).status).toBe("canceled");

    const drop = await votedPoll(host, { title: "Drop me" });
    const dropped = await bookDefault(host, drop.pollId, drop.options[1]!);
    await deletePoll(host.actor, { pollId: drop.pollId, cancelMeeting: true, reason: "No longer needed" });
    expect((await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, dropped.scheduledEventId)))[0]).toMatchObject({ status: "canceled", cancelReason: "No longer needed" });
    await drain(t.db, { lifecycle: true });
    expect(await outbox(t.db, { to: "bo@example.com", template: "lifecycle.invitee_canceled", scheduledEventId: dropped.scheduledEventId })).toHaveLength(1);
  });
});

describe("Reserve times (MP-25)", () => {
  it("blocks the owner's regular event type at a reserved time, and the holds go once booked", async () => {
    const host = await setupHost(t.db);
    const p = await votedPoll(host, { reserveTimes: true });
    const reserved = await getPollReservedIntervals([host.user.id], la("2030-10-09 00:00"), la("2030-10-11 00:00"));
    expect(reserved[host.user.id]?.map((b) => [new Date(b.start).toISOString(), b.title])).toEqual([
      [la("2030-10-09 10:00").toISOString(), "Reserved: Roadmap sync"],
      [la("2030-10-09 11:00").toISOString(), "Reserved: Roadmap sync"],
      [la("2030-10-10 14:00").toISOString(), "Reserved: Roadmap sync"],
    ]);
    const { eventType } = await createEventType(t.db, {
      owner: host.user,
      name: "30 Minute Virtual",
      slug: "30min",
      durationMinutes: 30,
      overrides: { slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, dateRangeType: "rolling", dateRangeDays: 60 },
    });
    // The booking page's slots leave the reserved times out (the booking transaction's own recheck is covered on real
    // Postgres in races.pg.test.ts: embedded PGlite has a single backend).
    const target = { kind: "event_type" as const, eventType: (await loadEventType(eventType.id))! };
    const starts = async () =>
      (await getAvailability({ target, start: la("2030-10-09 00:00"), end: la("2030-10-11 00:00"), now: now() })).slots.map((s) => new Date(s.start).toISOString());
    const before = await starts();
    expect(before).not.toContain(la("2030-10-09 10:00").toISOString());
    expect(before).not.toContain(la("2030-10-10 14:00").toISOString());
    expect(before).toContain(la("2030-10-09 12:00").toISOString());
    await bookDefault(host, p.pollId, p.options[0]!);
    expect(await getPollReservedIntervals([host.user.id], la("2030-10-09 00:00"), la("2030-10-11 00:00"))).toEqual({});
    expect(await starts()).toContain(la("2030-10-10 14:00").toISOString());
    const booked = await createBooking(
      { target: { kind: "event_type", eventTypeId: eventType.id }, start: la("2030-10-10 14:00").toISOString(), invitee: { name: "Zed", email: "zed@example.com", timezone: "UTC" } },
      { now: now() },
    );
    expect(booked.ok).toBe(true);
  });

  it("reads the holds inside a caller's transaction, and never waits on embedded PGlite's single backend", async () => {
    const host = await setupHost(t.db);
    await votedPoll(host, { reserveTimes: true });
    const range = [la("2030-10-09 00:00"), la("2030-10-11 00:00")] as const;
    const inside = await t.db.transaction(async (tx) => ({
      viaTx: await getPollReservedIntervals([host.user.id], range[0], range[1], { db: tx }),
      viaGlobal: await getPollReservedIntervals([host.user.id], range[0], range[1]),
    }));
    expect(inside.viaTx[host.user.id]).toHaveLength(3);
    expect(inside.viaGlobal).toEqual({});
    expect((await getPollReservedIntervals([host.user.id], range[0], range[1]))[host.user.id]).toHaveLength(3);
  });

  it("writes busy private holds without attendees to the Google destination and removes them on booking; the meeting event lists no invitees", async () => {
    const host = await setupHost(t.db);
    const { connection, calendars } = await createCalendarConnection(t.db, {
      userId: host.user.id,
      provider: "google",
      accountEmail: host.user.email,
      calendars: [{ externalId: host.user.email, isPrimary: true, canWrite: true, checkConflicts: true }],
    });
    await t.db.update(users).set({ destinationCalendarId: calendars[0]!.id }).where(eq(users.id, host.user.id));
    const p = await votedPoll(host, { reserveTimes: true });
    await drain(t.db);
    const provider = fakeCalendarProvider("google");
    const holds = provider.calls.filter((c) => c.method === "createEvent").map((c) => c.args[1] as { title: string; attendees: unknown[]; transparency: string; visibility?: string });
    expect(holds).toHaveLength(3);
    expect(holds.every((h) => h.title === "Reserved: Roadmap sync" && h.attendees.length === 0 && h.transparency === "busy" && h.visibility === "private")).toBe(true);
    expect((await getHostPoll(host.actor, p.pollId)).holds).toMatchObject({ enabled: true, active: 3, failed: 0 });

    const r = await bookDefault(host, p.pollId, p.options[0]!);
    await drain(t.db, { lifecycle: true });
    const live = await t.db.select().from(calendarLinkedEvents).where(and(eq(calendarLinkedEvents.pollId, p.pollId), eq(calendarLinkedEvents.purpose, "poll_hold")));
    expect(live.every((h) => h.status === "deleted")).toBe(true);
    expect(provider.calls.filter((c) => c.method === "deleteEvent")).toHaveLength(3);
    // MP-19: email confirmation mode, the host's provider event has no invitee attendees.
    const meetingWrite = provider.calls.filter((c) => c.method === "createEvent").map((c) => c.args[1] as { attendees: { email: string }[]; privateProperties: Record<string, string> }).find((w) => w.privateProperties.kairosEventId === r.scheduledEventId);
    expect(meetingWrite).toBeDefined();
    expect(meetingWrite!.attendees.map((a) => a.email)).not.toContain("ana@example.com");
    expect(meetingWrite!.attendees.map((a) => a.email)).not.toContain("bo@example.com");
    for (const inv of await inviteesOf(r.scheduledEventId)) {
      const mails = await outbox(t.db, { to: inv.email, template: "lifecycle.invitee_confirmation", scheduledEventId: r.scheduledEventId });
      expect(mails).toHaveLength(1);
      expect(mails[0]!.html).toContain(`/cancellations/${inv.id}`);
    }
    expect(connection.id).toBeDefined();
    expect(MIN).toBe(60_000);
  });
});
