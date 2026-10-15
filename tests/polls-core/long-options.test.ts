// Long and all-day poll options (SPEC MP-02, MP-18, MP-19, MP-21) on PGlite with the real booking-core and
// lifecycle-core: every option a poll can hold can be booked. A date-only option books the whole local day of the poll
// zone (25 hours on the daylight saving fall-back day) as an all-day meeting: DTSTART;VALUE=DATE in the invitee and
// host invites of the lifecycle emails, in the meeting ICS download and all-day "Add to calendar" links. Timed options
// up to 24 hours book as timed meetings. Rebooking a reopened poll moves an all-day meeting in place to another day or
// to a timed option (SEQUENCE + 1). Only timed options longer than 24 hours (data from before that limit) are refused.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/calendars", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/calendars")>();
  return {
    ...real,
    getExternalBusy: async (p: { userIds: string[] }) => Object.fromEntries(p.userIds.map((id) => [id, { ok: true, stale: false, nocal: false, busy: [] }])),
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

const { invitees, meetingPollOptions, scheduledEvents } = await import("@/db/schema");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { buildMeetingIcs } = await import("@/lib/email");
const { bookPoll, bookingPreview } = await import("@/lib/polls/book");
const { reopenPoll } = await import("@/lib/polls/manage");
const { getBookedMeetingIcs } = await import("@/lib/polls/queries");
const { MAX_BOOKABLE_MINUTES, MAX_OPTION_MINUTES, POLL_ERRORS } = await import("@/lib/polls/constants");
const { resetFakeProviders } = await import("../helpers/fake-providers");
const { useTestDb } = await import("../helpers/db");
const { MIN, NOW, drain, la, newPoll, opt, outbox, setupHost, vote } = await import("./helpers");

const t = useTestDb();
beforeEach(() => {
  setFakeNow(NOW);
  resetFakeProviders();
});
afterEach(() => resetFakeTime());

type Host = Awaited<ReturnType<typeof setupHost>>;

/** Option ids sorted by start (date-only options at local midnight of their date). */
async function optionIds(pollId: string): Promise<string[]> {
  const rows = (await t.db.select().from(meetingPollOptions).where(eq(meetingPollOptions.pollId, pollId))).filter((o) => !o.deletedAt);
  const key = (o: (typeof rows)[number]) => o.startsAt?.getTime() ?? la(`${o.allDayDate} 00:00`).getTime();
  return rows.sort((a, b) => key(a) - key(b)).map((o) => o.id);
}

/** A poll with Ana and Bo as respondents (both are invited by default). */
async function votedPoll(host: Host, options: NonNullable<NonNullable<Parameters<typeof newPoll>[1]>["options"]>) {
  const created = await newPoll(host, { options });
  const ids = await optionIds(created.pollId);
  const ana = await vote(created.slug, { name: "Ana Lima", email: "ana@example.com", votes: [{ optionId: ids[0]!, choice: "yes" }] });
  const bo = await vote(created.slug, { name: "Bo Chen", email: "bo@example.com", timezone: "Asia/Kolkata", votes: ids.map((optionId) => ({ optionId, choice: "yes" as const })) });
  if (!ana.ok || !bo.ok) throw new Error("votes failed");
  return { ...created, options: ids, ana, bo };
}

async function bookDefault(host: Host, pollId: string, optionId: string) {
  const preview = await bookingPreview(host.actor, pollId, optionId);
  expect(preview.unbookableReason).toBeNull();
  const chosen = preview.invitees.filter((i) => i.checked).map((i) => ({ participantId: i.participantId, email: i.email!, name: i.name }));
  return bookPoll(host.actor, { pollId, optionId, invitees: chosen });
}

async function meetingRow(id: string) {
  const [m] = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, id));
  return m!;
}

/** The unfolded ICS lines. */
const unfold = (ics: string | null | undefined) => (ics ?? "").replace(/\r?\n[ \t]/g, "");
const allDayOf = (ics: string | null | undefined) => {
  const s = unfold(ics);
  return { start: /^DTSTART;VALUE=DATE:(\d{8})$/m.exec(s)?.[1] ?? null, end: /^DTEND;VALUE=DATE:(\d{8})$/m.exec(s)?.[1] ?? null, timed: /^DTSTART:\d{8}T/m.test(s) };
};
const seqOf = (ics: string | null | undefined) => Number(/^SEQUENCE:(\d+)$/m.exec(unfold(ics))?.[1] ?? NaN);

describe("all-day options (MP-18, MP-19)", () => {
  it("book as an all-day meeting: VALUE=DATE invites in every lifecycle email, the downloads and all-day calendar links", async () => {
    const host = await setupHost(t.db);
    const p = await votedPoll(host, [opt("2030-10-09 10:00"), opt("2030-10-09 11:00"), { date: "2030-10-12" }]);
    const allDay = p.options[2]!;
    const r = await bookDefault(host, p.pollId, allDay);
    expect(r.mode).toBe("booked");
    const m = await meetingRow(r.scheduledEventId);
    expect(m).toMatchObject({ source: "poll", pollId: p.pollId, durationMinutes: 24 * 60, status: "active" });
    expect(m.startAt.toISOString()).toBe(la("2030-10-12 00:00").toISOString());
    expect(m.endAt.toISOString()).toBe(la("2030-10-13 00:00").toISOString());

    await drain(t.db, { lifecycle: true });
    for (const email of ["ana@example.com", "bo@example.com"]) {
      const [mail] = await outbox(t.db, { to: email, template: "lifecycle.invitee_confirmation", scheduledEventId: m.id });
      expect(mail, email).toBeDefined();
      expect(allDayOf(mail!.ics)).toEqual({ start: "20301012", end: "20301013", timed: false });
      // "Add to calendar": Google gets the dates of an all-day event, Outlook the allday flag.
      expect(mail!.html).toContain("dates=20301012%2F20301013");
      expect(mail!.html).toContain("allday=true");
    }
    // The host has no writable calendar here, so the "New Event" email carries the invite too (NT-02).
    const [hostMail] = await outbox(t.db, { to: host.user.email, template: "lifecycle.host_new_event", scheduledEventId: m.id });
    expect(allDayOf(hostMail!.ics)).toEqual({ start: "20301012", end: "20301013", timed: false });

    const [ana] = await t.db.select().from(invitees).where(eq(invitees.email, "ana@example.com"));
    const download = await buildMeetingIcs({ scheduledEventId: m.id, inviteeId: ana!.id, method: "REQUEST" });
    expect(download?.allDayDate).toBe("2030-10-12");
    expect(allDayOf(download?.content)).toEqual({ start: "20301012", end: "20301013", timed: false });
    expect(allDayOf((await getBookedMeetingIcs(p.slug, { editToken: p.ana.editToken }))?.ics)).toEqual({ start: "20301012", end: "20301013", timed: false });
    // A CANCEL of the meeting names the same all-day date.
    const cancel = await buildMeetingIcs({ scheduledEventId: m.id, inviteeId: ana!.id, method: "CANCEL" });
    expect(allDayOf(cancel?.content).start).toBe("20301012");
  });

  it("the daylight saving fall-back day books all 25 hours, still as one all-day date", async () => {
    const host = await setupHost(t.db);
    const p = await newPoll(host, { options: [{ date: "2030-11-03" }] });
    const [optionId] = await optionIds(p.pollId);
    const preview = await bookingPreview(host.actor, p.pollId, optionId!);
    expect(preview.unbookableReason).toBeNull();
    const r = await bookPoll(host.actor, { pollId: p.pollId, optionId: optionId!, invitees: [{ email: "cara@example.com", name: "Cara" }] });
    const m = await meetingRow(r.scheduledEventId);
    expect(m.startAt.toISOString()).toBe(new Date("2030-11-03T00:00:00-07:00").toISOString());
    expect(m.endAt.toISOString()).toBe(new Date("2030-11-04T00:00:00-08:00").toISOString());
    expect(m.durationMinutes).toBe(25 * 60);
    await drain(t.db, { lifecycle: true });
    const [mail] = await outbox(t.db, { to: "cara@example.com", template: "lifecycle.invitee_confirmation", scheduledEventId: m.id });
    expect(allDayOf(mail!.ics)).toEqual({ start: "20301103", end: "20301104", timed: false });
  });
});

describe("long timed options (MP-02, MP-18)", () => {
  it("book up to 24 hours as timed meetings", async () => {
    const host = await setupHost(t.db);
    expect(MAX_BOOKABLE_MINUTES).toBe(MAX_OPTION_MINUTES);
    const p = await newPoll(host, { options: [opt("2030-10-15 06:00", 18 * 60), opt("2030-10-16 08:00", 24 * 60)] });
    const [eighteen, day] = await optionIds(p.pollId);
    for (const [optionId, minutes] of [
      [eighteen!, 18 * 60],
      [day!, 24 * 60],
    ] as const) {
      expect((await bookingPreview(host.actor, p.pollId, optionId)).unbookableReason).toBeNull();
      const r = await bookPoll(host.actor, { pollId: p.pollId, optionId, invitees: [{ email: "dee@example.com", name: "Dee" }] });
      const m = await meetingRow(r.scheduledEventId);
      expect(m.durationMinutes).toBe(minutes);
      await drain(t.db, { lifecycle: true });
      const mails = await outbox(t.db, { to: "dee@example.com", scheduledEventId: m.id });
      expect(mails.length).toBeGreaterThan(0);
      expect(allDayOf(mails.at(-1)!.ics)).toMatchObject({ start: null, timed: true });
      if (optionId === eighteen) {
        // Book the other one next: reopen, then the meeting moves in place to the 24 hour time.
        await reopenPoll(host.actor, { pollId: p.pollId, notify: false });
      }
    }
  });

  it("only timed options longer than 24 hours (from before that limit) are refused", async () => {
    const host = await setupHost(t.db);
    const p = await newPoll(host);
    const start = la("2030-10-20 08:00");
    const [legacy] = await t.db
      .insert(meetingPollOptions)
      .values({ pollId: p.pollId, startsAt: start, endsAt: new Date(start.getTime() + 25 * 60 * MIN), durationMinutes: 25 * 60, position: 9 })
      .returning();
    expect((await bookingPreview(host.actor, p.pollId, legacy!.id)).unbookableReason).toBe(POLL_ERRORS.bookTooLong);
    expect(POLL_ERRORS.bookTooLong).toBe("Meetings can be at most 24 hours long, so this time can't be booked. Add a shorter time and book that one.");
    await expect(bookPoll(host.actor, { pollId: p.pollId, optionId: legacy!.id, invitees: [{ email: "x@example.com" }] })).rejects.toMatchObject({
      code: "validation",
      message: POLL_ERRORS.bookTooLong,
    });
  });
});

describe("rebooking all-day meetings (MP-21)", () => {
  it("moves the meeting in place to another day, then to a timed option; each update and cancel keeps the right shape", async () => {
    const host = await setupHost(t.db);
    const p = await votedPoll(host, [opt("2030-10-09 10:00"), { date: "2030-10-12" }, { date: "2030-10-13" }]);
    const [timed, sat, sun] = p.options;
    const first = await bookDefault(host, p.pollId, sat!);
    await drain(t.db, { lifecycle: true });
    const before = await meetingRow(first.scheduledEventId);

    // Another all-day option: the same meeting moves (24 hours is movable for poll meetings), SEQUENCE + 1.
    await reopenPoll(host.actor, { pollId: p.pollId, notify: false });
    const second = await bookDefault(host, p.pollId, sun!);
    expect(second).toEqual({ scheduledEventId: first.scheduledEventId, mode: "rebooked" });
    await drain(t.db, { lifecycle: true });
    const moved = await meetingRow(first.scheduledEventId);
    expect(moved.startAt.toISOString()).toBe(la("2030-10-13 00:00").toISOString());
    expect(moved.icsUid).toBe(before.icsUid);
    expect(moved.icsSequence).toBe(before.icsSequence + 1);
    const [update] = await outbox(t.db, { to: "bo@example.com", template: "lifecycle.invitee_rescheduled", scheduledEventId: moved.id });
    expect(allDayOf(update!.ics)).toEqual({ start: "20301013", end: "20301014", timed: false });
    expect(seqOf(update!.ics)).toBe(moved.icsSequence);

    // A timed option for Bo only: Ana gets the CANCEL of the same event (UID), Bo a timed update.
    await reopenPoll(host.actor, { pollId: p.pollId, notify: false });
    const third = await bookPoll(host.actor, { pollId: p.pollId, optionId: timed!, invitees: [{ participantId: p.bo.participantId, email: "bo@example.com" }] });
    expect(third).toEqual({ scheduledEventId: first.scheduledEventId, mode: "rebooked" });
    await drain(t.db, { lifecycle: true });
    const last = await meetingRow(first.scheduledEventId);
    expect(last.startAt.toISOString()).toBe(la("2030-10-09 10:00").toISOString());
    expect(last.durationMinutes).toBe(30);
    const [canceled] = await outbox(t.db, { to: "ana@example.com", template: "lifecycle.invitee_canceled", scheduledEventId: last.id });
    expect(/^METHOD:CANCEL$/m.test(unfold(canceled!.ics))).toBe(true);
    expect(/^UID:(.+)$/m.exec(unfold(canceled!.ics))?.[1]?.trim()).toBe(before.icsUid);
    const updates = await outbox(t.db, { to: "bo@example.com", template: "lifecycle.invitee_rescheduled", scheduledEventId: last.id });
    expect(updates).toHaveLength(2);
    expect(allDayOf(updates[1]!.ics)).toMatchObject({ start: null, timed: true });
    expect(seqOf(updates[1]!.ics)).toBe(last.icsSequence);
  });
});
