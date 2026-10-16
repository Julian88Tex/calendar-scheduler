// Persona emails (owner request, October 16): a booking made through a persona link stores the persona on the
// invitee, and its invitee and guest emails match that persona: the warm look gets the warm palette (cream canvas,
// terracotta buttons, rounder card), its greeting, thank-you line and sign-off, and no "Powered by"; every persona gets
// its event name and a "Schedule again" link back to its pages. Classic and host emails keep the normal layout.
import { describe, expect, it } from "vitest";
import { FRIENDS_PERSONA, inviteePersonaOf, personaUrl, withInviteePersona } from "@/components/booking/lib/personas";
import { applyEmailPersona, emailPalette, emailPersonaFor, renderMeetingEmail, type EmailBrand } from "@/lib/email";
import { TEMPLATE_PREVIEW_CONTEXT } from "@/lib/template";
import { createEventType, createUser } from "../factories";
import { useTestDb } from "../helpers/db";

const t = useTestDb();
const ctx = { ...TEMPLATE_PREVIEW_CONTEXT };
const plain: EmailBrand = { showPoweredBy: true };

describe("persona links and invitee metadata", () => {
  it("personaUrl adds ?for= except for the default persona", () => {
    expect(personaUrl("https://x.test/julian", { id: "friends", isDefault: false })).toBe("https://x.test/julian?for=friends");
    expect(personaUrl("https://x.test/julian/30min?month=2030-10", { id: "work", isDefault: false })).toBe("https://x.test/julian/30min?month=2030-10&for=work");
    expect(personaUrl("https://x.test/julian", { id: "business", isDefault: true })).toBe("https://x.test/julian");
    expect(personaUrl("https://x.test/julian", null)).toBe("https://x.test/julian");
  });

  it("stores only usable persona ids", () => {
    expect(withInviteePersona({}, "Friends")).toEqual({ persona: "friends" });
    expect(withInviteePersona({ other: 1 }, "not ok!")).toEqual({ other: 1 });
    expect(withInviteePersona({}, null)).toEqual({});
    expect(inviteePersonaOf({ persona: "friends" })).toBe("friends");
    expect(inviteePersonaOf({ persona: "<script>" })).toBeNull();
    expect(inviteePersonaOf(null)).toBeNull();
  });
});

describe("persona email look", () => {
  const warm = applyEmailPersona(plain, ctx, { persona: FRIENDS_PERSONA, eventName: "Quick video catch-up", hostFirstName: "Julian" });

  it("warm confirmations use the warm palette, voice and event name", () => {
    const e = renderMeetingEmail({ kind: "invitee_confirmation", ctx: warm.ctx, brand: warm.brand });
    expect(e.subject).toBe("It's a date! Quick video catch-up with Jordan Lee");
    expect(e.text).toMatch(/^Hey Sam!\n/);
    expect(e.text).toContain("Event\nQuick video catch-up");
    expect(e.text).toContain(FRIENDS_PERSONA.confirmationNote);
    expect(e.text).toContain("Can't wait to see you,\nJulian");
    expect(e.text).not.toContain("Powered by");
    expect(e.html).toContain("background-color:#FBF3E8");
    expect(e.html).toContain("#B5482A");
    expect(e.html).toContain("border-radius:20px");
    expect(e.html).not.toContain("#006BFF");
  });

  it("warm cancellations keep the voice but no thank-you or sign-off, and Schedule again opens the persona", () => {
    const e = renderMeetingEmail({ kind: "invitee_canceled", ctx: warm.ctx, brand: warm.brand });
    expect(e.text).toMatch(/^Hey Sam!\n/);
    expect(e.text).not.toContain(FRIENDS_PERSONA.confirmationNote);
    expect(e.text).not.toContain("Can't wait to see you");
    expect(String(warm.ctx.event_type_url)).toMatch(/[?&]for=friends$/);
    expect(e.html).toContain("for=friends");
  });

  it("guests get the warm greeting without a name; host emails keep the classic voice", () => {
    expect(renderMeetingEmail({ kind: "guest_confirmation", ctx: { ...warm.ctx, invitee_first_name: "" }, brand: warm.brand }).text).toMatch(/^Hey there!\n/);
    const host = renderMeetingEmail({ kind: "host_new_event", ctx, brand: plain });
    expect(host.text).toMatch(/^Hi Jordan Lee,\n/);
    expect(host.html).toContain("#FAFAFA");
  });

  it("classic personas keep the classic layout and copy, with their event name", () => {
    const work = applyEmailPersona(plain, ctx, { persona: { ...FRIENDS_PERSONA, id: "work", style: "classic" }, eventName: "Project sync", hostFirstName: "Julian" });
    const e = renderMeetingEmail({ kind: "invitee_confirmation", ctx: work.ctx, brand: work.brand });
    expect(e.subject).toMatch(/^Confirmed: Project sync with Jordan Lee/);
    expect(e.text).toMatch(/^Hi Sam,\n/);
    expect(e.text).toContain("Powered by");
    expect(e.html).toContain("#006BFF");
    expect(emailPalette(work.brand).radius).toBe(8);
  });

  it("no persona leaves the email unchanged", () => {
    expect(applyEmailPersona(plain, ctx, null)).toEqual({ brand: plain, ctx });
  });
});

describe("emailPersonaFor", () => {
  it("reads the booking's persona and its event name from the host's settings", async () => {
    const host = await createUser(t.db, { name: "Julian Joseph" });
    const { eventType } = await createEventType(t.db, { owner: host, slug: "30min" });
    const p = await emailPersonaFor({ hostUserId: host.id, eventTypeId: eventType.id, inviteeMetadata: { persona: "friends" }, db: t.db });
    expect(p?.persona.style).toBe("warm");
    expect(p?.eventName).toBe("Quick video catch-up");
    expect(p?.hostFirstName).toBe("Julian");
    expect(await emailPersonaFor({ hostUserId: host.id, eventTypeId: eventType.id, inviteeMetadata: {}, db: t.db })).toBeNull();
    expect(await emailPersonaFor({ hostUserId: host.id, eventTypeId: eventType.id, inviteeMetadata: { persona: "gone" }, db: t.db })).toBeNull();
  });
});
