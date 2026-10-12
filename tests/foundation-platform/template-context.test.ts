// buildMeetingTemplateContext (SPEC NT-07, GEN-06, GEN-10): every NT-07 variable for invitee, host and other
// recipients in the right zone, time format and locale, from schema rows created by the factories.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { eventTypes, inviteeGuests } from "@/db/schema";
import type { ResolvedLocation } from "@/db/types";
import { TEMPLATE_KEYS, renderTemplate } from "@/lib/template";
import { buildMeetingTemplateContext, locationText } from "@/lib/template-context";
import { createBooking, createEventType, createTeam, createUser } from "../factories";
import { useTestDb } from "../helpers/db";

const t = useTestDb();

const meet = (over: Partial<ResolvedLocation> = {}): ResolvedLocation => ({
  configId: null,
  kind: "google_conference",
  location: null,
  additionalInfo: null,
  joinUrl: "https://meet.google.com/abc-defg-hij",
  status: "pushed",
  providerMeetingId: "abc-defg-hij",
  password: null,
  dialIn: null,
  data: null,
  error: null,
  ...over,
});

let seq = 0;
async function setup() {
  seq++;
  const host = await createUser(t.db, { name: "Jordan Lee", email: `jordan${seq}@example.com`, timezone: "America/Los_Angeles", slug: `jordan-${seq}` });
  const { eventType } = await createEventType(t.db, {
    owner: host,
    name: "30 Minute Meeting",
    slug: "30min",
    overrides: { descriptionPlain: "A quick intro call.", descriptionHtml: "<p>A quick intro call.</p>" },
  });
  const { scheduledEvent, invitee } = await createBooking(t.db, {
    eventType,
    start: "2026-10-20T12:00:00Z",
    location: meet(),
    invitee: {
      name: "Sam Rivera",
      email: "sam@example.com",
      timezone: "Europe/Berlin",
      guests: ["alex@example.com", "kim@example.com"],
      questionsAndAnswers: [
        { questionId: "q2", question: "Company", type: "text", position: 2, answer: "Acme" },
        { questionId: "q1", question: "Please share anything that will help prepare for our meeting.", type: "textarea", position: 1, answer: "Pricing\nTimeline" },
        { questionId: "q3", question: "Skipped", type: "text", position: 3, answer: "" },
      ],
      overrides: {
        timeFormat: "24h",
        locale: "de",
        textReminderNumber: "+4915112345678",
        utmSource: "newsletter",
        utmMedium: "email",
        utmCampaign: "fall",
        utmContent: "hero",
        utmTerm: "scheduling",
      },
    },
  });
  return { host, eventType, scheduledEvent, invitee: invitee! };
}

describe("buildMeetingTemplateContext", () => {
  it("invitee recipients: the invitee's stored zone, 24h format and locale; every NT-07 key present", async () => {
    const { host, scheduledEvent, invitee } = await setup();
    const ctx = await buildMeetingTemplateContext({ scheduledEventId: scheduledEvent.id, inviteeId: invitee.id, recipient: "invitee" });
    for (const key of TEMPLATE_KEYS) expect(ctx, key).toHaveProperty(key);
    expect(ctx).toMatchObject({
      event_name: "30 Minute Meeting",
      event_date: "Dienstag, 20. Oktober 2026",
      event_time: "14:00",
      event_end_time: "14:30",
      event_description: "A quick intro call.",
      location: "https://meet.google.com/abc-defg-hij",
      join_url: `http://localhost:3000/events/${scheduledEvent.id}/join`,
      my_name: "Jordan Lee",
      host_name: "Jordan Lee",
      host_email: host.email,
      invitees_count: 1,
      invitee_full_name: "Sam Rivera",
      invitee_first_name: "Sam",
      invitee_last_name: "Rivera",
      invitee_email: "sam@example.com",
      invitee_phone_number: "+4915112345678",
      invitee_uuid: invitee.id,
      guests: "alex@example.com, kim@example.com",
      questions_and_answers: "Please share anything that will help prepare for our meeting.\nPricing\nTimeline\n\nCompany\nAcme",
      answer_1: "Pricing\nTimeline",
      answer_2: "Acme",
      answer_3: "",
      answer_10: "",
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: "fall",
      utm_content: "hero",
      utm_term: "scheduling",
      cancel_url: `http://localhost:3000/cancellations/${invitee.id}`,
      reschedule_url: `http://localhost:3000/reschedulings/${invitee.id}`,
      reconfirm_url: `http://localhost:3000/reconfirm/${invitee.id}`,
      event_type_url: `http://localhost:3000/${host.slug}/30min`,
    });
    // German zone name from Intl (no German catalog yet), GEN-10.
    expect(String(ctx.event_time_zone)).toMatch(/Mitteleurop/);
  });

  it("renders the NT-07 acceptance template in the invitee's local time", async () => {
    const { scheduledEvent, invitee } = await setup();
    const ctx = await buildMeetingTemplateContext({ scheduledEventId: scheduledEvent.id, inviteeId: invitee.id, recipient: "invitee", locale: "en" });
    expect(renderTemplate("Hi {{invitee_first_name}}, see you at {{event_time}}", ctx)).toBe("Hi Sam, see you at 14:00");
    const twelve = await buildMeetingTemplateContext({
      scheduledEventId: scheduledEvent.id,
      inviteeId: invitee.id,
      recipient: "invitee",
      locale: "en",
      timeFormat: "12h",
    });
    expect(renderTemplate("{{event_time}} - {{event_end_time}}, {{event_date}} ({{event_time_zone}})", twelve)).toBe(
      "2:00pm - 2:30pm, Tuesday, October 20, 2026 (Central European Time)",
    );
  });

  it("host recipients: the host's profile zone and 12h format in English; other hosts their own zone", async () => {
    const { scheduledEvent, invitee } = await setup();
    const ctx = await buildMeetingTemplateContext({ scheduledEventId: scheduledEvent.id, inviteeId: invitee.id, recipient: "host" });
    expect(ctx).toMatchObject({
      event_time: "5:00am",
      event_end_time: "5:30am",
      event_date: "Tuesday, October 20, 2026",
      event_time_zone: "Pacific Time - US & Canada",
      invitee_full_name: "Sam Rivera",
    });
    const cohost = await createUser(t.db, { timezone: "Asia/Tokyo", overrides: { timeFormat: "24h" } });
    const other = await buildMeetingTemplateContext({ scheduledEventId: scheduledEvent.id, recipient: "host", hostUserId: cohost.id });
    expect(other).toMatchObject({ event_time: "21:00", event_date: "Tuesday, October 20, 2026", event_time_zone: "Japan, Korea Time" });
    // Without an invitee the invitee variables are absent and render as empty text.
    expect(other.invitee_full_name).toBeUndefined();
    expect(renderTemplate("[{{invitee_full_name}}][{{cancel_url}}][{{answer_1}}]", other)).toBe("[][][]");
  });

  it("other recipients: the meeting's display zone (locked zone when locked)", async () => {
    const { scheduledEvent, invitee } = await setup();
    const ctx = await buildMeetingTemplateContext({ scheduledEventId: scheduledEvent.id, inviteeId: invitee.id, recipient: "other" });
    expect(ctx).toMatchObject({ event_time: "5:00am", event_time_zone: "Pacific Time - US & Canada" });
    const { db } = t;
    const { scheduledEvents } = await import("@/db/schema");
    await db
      .update(scheduledEvents)
      .set({ settingsSnapshot: { ...scheduledEvent.settingsSnapshot, timeZoneDisplay: "locked", lockedTimeZone: "America/New_York" } })
      .where(eq(scheduledEvents.id, scheduledEvent.id));
    const locked = await buildMeetingTemplateContext({ scheduledEventId: scheduledEvent.id, recipient: "other" });
    expect(locked).toMatchObject({ event_time: "8:00am", event_time_zone: "Eastern Time - US & Canada" });
  });

  it("explicit overrides win; canceled guests are left out; team types link to the team page", async () => {
    const { scheduledEvent, invitee, eventType } = await setup();
    await t.db.update(inviteeGuests).set({ canceledAt: new Date() }).where(eq(inviteeGuests.email, "kim@example.com"));
    const ctx = await buildMeetingTemplateContext({
      scheduledEventId: scheduledEvent.id,
      inviteeId: invitee.id,
      recipient: "invitee",
      timeZone: "Asia/Kolkata",
      timeFormat: "12h",
      locale: "fr",
    });
    expect(String(ctx.event_time)).toMatch(/5:30/);
    expect(String(ctx.event_date)).toMatch(/mardi 20 octobre 2026/);
    expect(ctx.guests).toBe("alex@example.com");
    const admin = await createUser(t.db);
    const { team } = await createTeam(t.db, { organizationId: admin.organizationId, name: "Sales" });
    await t.db.update(eventTypes).set({ teamId: team.id, ownerUserId: null, scope: "team" }).where(eq(eventTypes.id, eventType.id));
    const teamCtx = await buildMeetingTemplateContext({ scheduledEventId: scheduledEvent.id, recipient: "other" });
    expect(teamCtx.event_type_url).toBe(`http://localhost:3000/${team.slug}/30min`);
  });

  it("returns {} for a missing meeting and ignores an invitee of another meeting", async () => {
    expect(await buildMeetingTemplateContext({ scheduledEventId: "00000000-0000-4000-8000-000000000999", recipient: "other" })).toEqual({});
    const a = await setup();
    const b = await setup();
    const ctx = await buildMeetingTemplateContext({ scheduledEventId: a.scheduledEvent.id, inviteeId: b.invitee.id, recipient: "invitee" });
    expect(ctx.invitee_email).toBeUndefined();
  });

  it("location text: conferences show the join URL or 'Web conferencing details to follow.'", () => {
    expect(locationText(meet(), "en")).toBe("https://meet.google.com/abc-defg-hij");
    expect(locationText(meet({ joinUrl: null, status: "processing" }), "en")).toBe("Web conferencing details to follow.");
    expect(locationText(meet({ kind: "physical", joinUrl: null, location: "1 Main St" }), "en")).toBe("1 Main St");
    expect(locationText(meet({ kind: null, joinUrl: null }), "en")).toBe("");
  });
});
