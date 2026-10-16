// Link preview cards (owner request, October 16): a shared landing or booking page link previews as a large card with
// the host's photo, in the look and words of the persona the link asks for; the friends card is warm (greeting, note,
// favorites), the business card classic. Event types a persona does not list fall back to the landing card. Also the
// even chip rows of the warm landing page on phones.
import { describe, expect, it } from "vitest";
import { FRIENDS_PERSONA, type Persona } from "@/components/booking/lib/personas";
import type { LandingData } from "@/components/booking/server/landing";
import { ogCardOf, ogImageUrl } from "@/components/booking/server/og-card";
import { largeAvatarUrl, renderOgImage } from "@/components/booking/server/og-image";
import { balancedRowEnds } from "@/components/public/persona-landing";

const landing: LandingData = {
  kind: "user",
  handle: "julianjoseph",
  userId: "u1",
  name: "Julian Joseph",
  avatarUrl: null,
  logoUrl: null,
  welcomeMessage: "Pick a time that works for you.",
  branding: { primaryColor: null, backgroundColor: null, textColor: null },
  ribbon: false,
  privacyUrl: null,
  items: [
    { id: "a", name: "30 Minute Meeting", color: "#8247f5", slug: "30min", description: "A quick call.", personas: { business: { name: "", description: "" }, friends: { name: "Quick video catch-up", description: "Thirty minutes to hear what's new with you." } } },
    { id: "b", name: "Intro call", color: "#8247f5", slug: "intro", description: null, personas: { business: { name: "", description: "" } } },
  ],
};
const business: Persona = { ...FRIENDS_PERSONA, id: "business", name: "Business", isDefault: true, style: "classic", greeting: "", note: "", favorites: [] };

describe("link preview card content", () => {
  it("friends landing: warm, greeting, note and favorites", () => {
    const c = ogCardOf(landing, FRIENDS_PERSONA, null, "julendly.test");
    expect(c.look).toBe("warm");
    expect(c.eyebrow).toBe("Time with Julian");
    expect(c.headline).toBe(FRIENDS_PERSONA.greeting);
    expect(c.chips.length).toBeGreaterThan(0);
    expect(c.footer).toBe("julendly.test/julianjoseph");
  });

  it("business landing: classic with the host's name and welcome message", () => {
    const c = ogCardOf(landing, business, null, "julendly.test");
    expect(c).toMatchObject({ look: "classic", eyebrow: "Book a time", headline: "Julian Joseph", body: "Pick a time that works for you.", chips: [] });
  });

  it("event cards use the persona's event name, and fall back to the landing card for unlisted types", () => {
    expect(ogCardOf(landing, FRIENDS_PERSONA, "30min", "h")).toMatchObject({ look: "warm", eyebrow: "Pick a time with Julian", headline: "Quick video catch-up", footer: "h/julianjoseph/30min" });
    expect(ogCardOf(landing, business, "30min", "h")).toMatchObject({ look: "classic", eyebrow: "Julian Joseph", headline: "30 Minute Meeting", body: "A quick call." });
    expect(ogCardOf(landing, FRIENDS_PERSONA, "intro", "h")).toMatchObject({ headline: FRIENDS_PERSONA.greeting, footer: "h/julianjoseph" });
    expect(ogCardOf(landing, business, "secret-or-unknown", "h")).toMatchObject({ headline: "Julian Joseph", footer: "h/julianjoseph" });
  });

  it("image URLs carry the handle, event and persona", () => {
    const u = new URL(ogImageUrl({ handle: "julianjoseph", event: "30min", persona: "friends" }));
    expect(u.pathname).toBe("/api/public/og");
    expect(Object.fromEntries(u.searchParams)).toEqual({ handle: "julianjoseph", event: "30min", for: "friends" });
  });

  it("asks Google for a large photo", () => {
    expect(largeAvatarUrl("https://lh3.googleusercontent.com/a/abc=s96-c")).toBe("https://lh3.googleusercontent.com/a/abc=s512-c");
  });
});

describe("link preview image", () => {
  it("renders a 1200x630 PNG for both looks", async () => {
    for (const card of [ogCardOf(landing, FRIENDS_PERSONA, null, "h"), ogCardOf(landing, business, "30min", "h")]) {
      const res = await renderOgImage({ ...card, chips: card.chips.map((c) => ({ ...c, emoji: "" })) });
      expect(res.headers.get("content-type")).toBe("image/png");
      const png = Buffer.from(await res.arrayBuffer());
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect(png.readUInt32BE(16)).toBe(1200);
      expect(png.readUInt32BE(20)).toBe(630);
    }
  }, 30_000);
});

describe("even chip rows", () => {
  it("splits chips into rows of near equal size", () => {
    expect([...balancedRowEnds(3, 3)]).toEqual([]);
    expect([...balancedRowEnds(4, 3)]).toEqual([1]);
    expect([...balancedRowEnds(5, 3)]).toEqual([2]);
    expect([...balancedRowEnds(6, 3)]).toEqual([2]);
    expect([...balancedRowEnds(7, 3)]).toEqual([2, 4]);
    expect([...balancedRowEnds(0, 3)]).toEqual([]);
  });
});
